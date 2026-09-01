/**
 * ROK-1451 — LFG intents: schema, +1 mechanic, and expiry lifecycle.
 *
 * TDD spec written BEFORE the implementation. Every test below encodes an
 * acceptance criterion from `planning-artifacts/specs/ROK-1451.md`; until the
 * `lfg_intents` table, `LfgModule` and the `LfgExpiryService` cron exist these
 * fail on a real assertion (404 from an unmounted route, or `relation
 * "lfg_intents" does not exist` from the raw-SQL readers).
 *
 * The central design call under test: **LFG vs LFM is DERIVED, never stored.**
 * Count active intents for a game — 1 → 'lfg', >= 2 → 'lfm', 0 → null.
 */
import { SchedulerRegistry } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../events/signups.integration.spec-helpers';
import {
  LFG_EXPIRY_JOB_NAME,
  LFG_EXPIRY_CRON_EXPRESSION,
  LFG_EXPIRY_DAYS,
  DAY_MS,
  createGame,
  heartGame,
  createLineupMatch,
  deactivateUser,
  banUser,
  readIntent,
  readIntentsForGame,
  setExpiresAt,
  countGameInterests,
  daysFromNow,
  type LfgIntentResponseDto,
  type LfgGroupSummaryDto,
  type LfgGroupDetailDto,
  type LfgHeartedGameDto,
} from './lfg.integration.spec-helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── local request wrappers ──────────────────────────────────────────────────

function postIntent(token: string, gameId: number, extra = {}) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId, ...extra });
}

function getGroups(token: string) {
  return testApp.request.get('/lfg').set('Authorization', `Bearer ${token}`);
}

function getGroup(token: string, gameId: number) {
  return testApp.request
    .get(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${token}`);
}

function convert(token: string, gameId: number, body: object) {
  return testApp.request
    .post(`/lfg/${gameId}/convert`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** Create N logged-in members with predictable usernames. */
async function members(...names: string[]) {
  const out: Array<{ userId: number; token: string; username: string }> = [];
  for (const name of names) {
    const m = await createMemberAndLogin(testApp, name, `${name}@test.local`);
    out.push({ ...m, username: name });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 — LFG → LFM transition (AC1, AC3, AC4)
// ═══════════════════════════════════════════════════════════════════════════

describe('LFG → LFM transition', () => {
  it('derives lfg at one intent and lfm at two — the +1 IS another intent', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Deep Rock');

    const first = await postIntent(a.token, game.id);
    expect(first.status).toBe(201);
    const firstBody = first.body as LfgIntentResponseDto;
    expect(firstBody).toMatchObject({
      userId: a.userId,
      gameId: game.id,
      status: 'active',
      visibility: 'local',
    });
    expect(firstBody.group).toMatchObject({ activeCount: 1, state: 'lfg' });

    const soloDetail = (await getGroup(a.token, game.id))
      .body as LfgGroupDetailDto;
    expect(soloDetail).toMatchObject({ activeCount: 1, state: 'lfg' });
    expect(soloDetail.members.map((m) => m.userId)).toEqual([a.userId]);
    expect(soloDetail.ownIntent?.id).toBe(firstBody.id);

    const second = await postIntent(b.token, game.id);
    expect(second.status).toBe(201);
    expect((second.body as LfgIntentResponseDto).group).toMatchObject({
      activeCount: 2,
      state: 'lfm',
    });

    const pairDetail = (await getGroup(a.token, game.id))
      .body as LfgGroupDetailDto;
    expect(pairDetail).toMatchObject({ activeCount: 2, state: 'lfm' });
    expect(pairDetail.members.map((m) => m.userId).sort()).toEqual(
      [a.userId, b.userId].sort(),
    );

    // Derived, not stored: two plain rows, both still 'active'.
    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows.map((r) => r.status)).toEqual(['active', 'active']);
  });

  it('GET /lfg groups active intents by game, ordered by activeCount desc', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const busy = await createGame(testApp, 'Busy Game');
    const quiet = await createGame(testApp, 'Quiet Game');
    await postIntent(a.token, busy.id);
    await postIntent(b.token, busy.id);
    await postIntent(b.token, quiet.id);

    const res = await getGroups(a.token);
    expect(res.status).toBe(200);
    const groups = res.body as LfgGroupSummaryDto[];
    expect(groups.map((g) => g.gameId)).toEqual([busy.id, quiet.id]);
    expect(groups[0]).toMatchObject({
      gameName: 'Busy Game',
      activeCount: 2,
      state: 'lfm',
      hasOwnIntent: true,
    });
    expect(groups[1]).toMatchObject({
      activeCount: 1,
      state: 'lfg',
      hasOwnIntent: false,
    });
  });

  it('re-posting an active intent returns the existing row without duplicating it', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Valheim');

    const created = await postIntent(a.token, game.id);
    expect(created.status).toBe(201);
    const repost = await postIntent(a.token, game.id);
    expect(repost.status).toBe(200);
    expect((repost.body as LfgIntentResponseDto).id).toBe(
      (created.body as LfgIntentResponseDto).id,
    );
    expect((repost.body as LfgIntentResponseDto).group.activeCount).toBe(1);
    expect(await readIntentsForGame(testApp, game.id)).toHaveLength(1);
  });

  it('returns 200 with an empty derived group for a game nobody is looking for', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Lonely Game');

    const res = await getGroup(a.token, game.id);
    expect(res.status).toBe(200);
    expect(res.body as LfgGroupDetailDto).toMatchObject({
      gameId: game.id,
      activeCount: 0,
      state: null,
      members: [],
      ownIntent: null,
    });
  });

  it('404s a POST for a game that does not exist', async () => {
    const [a] = await members('alpha');
    // Positive control: the same route must succeed for a real game, so a
    // 404 here proves the game lookup — not a missing route.
    const real = await createGame(testApp, 'Real Game');
    expect((await postIntent(a.token, real.id)).status).toBe(201);
    expect((await postIntent(a.token, 987654)).status).toBe(404);
  });

  it('requires authentication on every LFG route', async () => {
    const game = await createGame(testApp, 'Guarded Game');
    expect(
      (await testApp.request.post('/lfg').send({ gameId: game.id })).status,
    ).toBe(401);
    expect((await testApp.request.get('/lfg')).status).toBe(401);
    expect((await testApp.request.get(`/lfg/${game.id}`)).status).toBe(401);
    expect((await testApp.request.get('/lfg/hearted')).status).toBe(401);
    expect((await testApp.request.delete(`/lfg/${game.id}`)).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2 — the +1 refreshes the whole group's clock (AC5, AC13)
// ═══════════════════════════════════════════════════════════════════════════

describe('+1 expiry refresh', () => {
  it('pushes expires_at ~14 days out for EVERY active intent on the game', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Helldivers');

    const aIntent = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;
    // A is nearly stale — one day left on the clock.
    await setExpiresAt(testApp, aIntent.id, new Date(Date.now() + DAY_MS));
    const before = await readIntent(testApp, a.userId, game.id);
    expect(daysFromNow(before!.expires_at)).toBeLessThan(2);

    await postIntent(b.token, game.id);

    const aAfter = await readIntent(testApp, a.userId, game.id);
    const bAfter = await readIntent(testApp, b.userId, game.id);
    expect(daysFromNow(aAfter!.expires_at)).toBeGreaterThan(
      LFG_EXPIRY_DAYS - 1,
    );
    expect(daysFromNow(aAfter!.expires_at)).toBeLessThanOrEqual(
      LFG_EXPIRY_DAYS,
    );
    expect(daysFromNow(bAfter!.expires_at)).toBeGreaterThan(
      LFG_EXPIRY_DAYS - 1,
    );
  });

  it('does NOT refresh the group clock on a re-post by an existing holder', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Grounded');

    const intent = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;
    const nearExpiry = new Date(Date.now() + 2 * DAY_MS);
    await setExpiresAt(testApp, intent.id, nearExpiry);

    const repost = await postIntent(a.token, game.id);
    expect(repost.status).toBe(200);

    const row = await readIntent(testApp, a.userId, game.id);
    expect(new Date(row!.expires_at).getTime()).toBe(nearExpiry.getTime());
  });

  it('revives a stale intent in place rather than inserting a duplicate', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Terraria');

    const intent = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - DAY_MS));

    const revived = await postIntent(a.token, game.id);
    expect(revived.status).toBe(200);
    expect((revived.body as LfgIntentResponseDto).id).toBe(intent.id);

    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect(daysFromNow(rows[0].expires_at)).toBeGreaterThan(
      LFG_EXPIRY_DAYS - 1,
    );
  });

  it('stores visibility as local and never honours a client-supplied value', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Relay Game');

    const plain = await postIntent(a.token, game.id);
    expect((plain.body as LfgIntentResponseDto).visibility).toBe('local');
    expect((await readIntent(testApp, a.userId, game.id))!.visibility).toBe(
      'local',
    );

    const [b] = await members('bravo');
    const smuggled = await postIntent(b.token, game.id, {
      visibility: 'cross-community',
    });
    // Either the field is rejected outright or it is ignored — it must never
    // be honoured while only `local` is implemented (AC12).
    if (smuggled.status < 400) {
      expect((await readIntent(testApp, b.userId, game.id))!.visibility).toBe(
        'local',
      );
    } else {
      expect(smuggled.status).toBe(400);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3 — event-signup clearing via the signup.created emitter (AC6)
// ═══════════════════════════════════════════════════════════════════════════

describe('event-signup clearing', () => {
  it('clears the signer intent for the event game and leaves other games alone', async () => {
    const [a] = await members('alpha');
    const target = await createGame(testApp, 'Signup Game');
    const other = await createGame(testApp, 'Untouched Game');
    await postIntent(a.token, target.id);
    await postIntent(a.token, other.id);

    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: target.id,
    });
    const signup = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({});
    expect(signup.status).toBe(201);

    await waitFor(async () => {
      const row = await readIntent(testApp, a.userId, target.id);
      expect(row?.status).toBe('cleared');
    }, 5000);

    expect((await readIntent(testApp, a.userId, other.id))!.status).toBe(
      'active',
    );
    const detail = (await getGroup(a.token, target.id))
      .body as LfgGroupDetailDto;
    expect(detail).toMatchObject({ activeCount: 0, state: null, members: [] });
  });

  it('leaves intents alone when the signed-up event has no game', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Gameless Event Game');
    await postIntent(a.token, game.id);

    const eventId = await createFutureEvent(testApp, adminToken);
    const signup = await testApp.request
      .post(`/events/${eventId}/signup`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({});
    expect(signup.status).toBe(201);

    // The listener must no-op; give the emitter a full turn, then assert the
    // count is still 1 (a spurious clear would drop it to 0).
    await waitFor(async () => {
      const detail = (await getGroup(a.token, game.id))
        .body as LfgGroupDetailDto;
      expect(detail.activeCount).toBe(1);
    }, 3000);
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4 — expiry cron (AC9)
// ═══════════════════════════════════════════════════════════════════════════

describe('expiry cron', () => {
  it('is registered in the scheduler and in the admin cron-job registry', async () => {
    const scheduler = testApp.app.get(SchedulerRegistry, { strict: false });
    expect(scheduler.getCronJob(LFG_EXPIRY_JOB_NAME)).toBeDefined();

    const res = await testApp.request
      .get('/admin/cron-jobs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const job = (res.body as Array<Record<string, unknown>>).find(
      (j) => j.name === LFG_EXPIRY_JOB_NAME,
    );
    expect(job).toMatchObject({
      category: 'Maintenance',
      cronExpression: LFG_EXPIRY_CRON_EXPRESSION,
    });
  });

  it('flips past-expiry intents to expired and drops them out of GET /lfg', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const stale = await createGame(testApp, 'Stale Game');
    const live = await createGame(testApp, 'Live Game');
    const staleIntent = (await postIntent(a.token, stale.id))
      .body as LfgIntentResponseDto;
    await postIntent(b.token, live.id);
    await setExpiresAt(testApp, staleIntent.id, new Date(Date.now() - DAY_MS));

    // A stale row must ALREADY be invisible — reads filter on expires_at, the
    // cron is only bookkeeping.
    const beforeSweep = (await getGroups(a.token)).body as LfgGroupSummaryDto[];
    expect(beforeSweep.map((g) => g.gameId)).toEqual([live.id]);

    const scheduler = testApp.app.get(SchedulerRegistry, { strict: false });
    await scheduler.getCronJob(LFG_EXPIRY_JOB_NAME).fireOnTick();

    expect((await readIntent(testApp, a.userId, stale.id))!.status).toBe(
      'expired',
    );
    expect((await readIntent(testApp, b.userId, live.id))!.status).toBe(
      'active',
    );
    const afterSweep = (await getGroups(a.token)).body as LfgGroupSummaryDto[];
    expect(afterSweep.map((g) => g.gameId)).toEqual([live.id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5 — concurrent double-post against the partial unique index (AC11)
// ═══════════════════════════════════════════════════════════════════════════

describe('concurrency guard', () => {
  it('yields exactly one row when the same user double-posts in flight', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Race Game');

    const [r1, r2] = await Promise.all([
      postIntent(a.token, game.id),
      postIntent(a.token, game.id),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const b1 = r1.body as LfgIntentResponseDto;
    const b2 = r2.body as LfgIntentResponseDto;
    expect(b1.id).toBe(b2.id);

    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect((await getGroup(a.token, game.id)).body).toMatchObject({
      activeCount: 1,
      state: 'lfg',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 6 — conversion + provenance + idempotency (AC8)
// ═══════════════════════════════════════════════════════════════════════════

describe('conversion', () => {
  it('converts every active intent on the game and records poll provenance', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Convert Game');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    const pollId = await createLineupMatch(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
    );

    const res = await convert(a.token, game.id, { pollId });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ converted: 2 });

    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows.map((r) => r.status)).toEqual(['converted', 'converted']);
    expect(rows.every((r) => r.converted_to_poll_id === pollId)).toBe(true);
    expect(rows.every((r) => r.converted_to_event_id === null)).toBe(true);

    expect((await getGroups(a.token)).body).toEqual([]);
  });

  it('is idempotent — a second convert reports zero converted, not an error', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Twice Game');
    await postIntent(a.token, game.id);
    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });

    const first = await convert(a.token, game.id, { eventId });
    expect((first.body as { converted: number }).converted).toBe(1);
    expect(
      (await readIntent(testApp, a.userId, game.id))!.converted_to_event_id,
    ).toBe(eventId);

    const second = await convert(a.token, game.id, { eventId });
    expect(second.status).toBeLessThan(400);
    expect(second.body).toEqual({ converted: 0 });
  });

  it('400s when neither or both of pollId/eventId are supplied', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Bad Body Game');
    await postIntent(a.token, game.id);
    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });
    const pollId = await createLineupMatch(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
    );

    expect((await convert(a.token, game.id, {})).status).toBe(400);
    expect((await convert(a.token, game.id, { pollId, eventId })).status).toBe(
      400,
    );
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });

  it('403s a bystander who holds no active intent on the game', async () => {
    const [a, bystander] = await members('alpha', 'bystander');
    const game = await createGame(testApp, 'Members Only Game');
    await postIntent(a.token, game.id);
    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });

    expect((await convert(bystander.token, game.id, { eventId })).status).toBe(
      403,
    );
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 7 — deactivated / banned holders excluded
// ═══════════════════════════════════════════════════════════════════════════

describe('excluded holders', () => {
  it('never lets a deactivated or banned holder inflate a group into lfm', async () => {
    const [a, gone, banned] = await members('alpha', 'gone', 'banned');
    const game = await createGame(testApp, 'Exclusion Game');
    await postIntent(a.token, game.id);
    await postIntent(gone.token, game.id);
    await postIntent(banned.token, game.id);

    const before = (await getGroup(a.token, game.id)).body as LfgGroupDetailDto;
    expect(before).toMatchObject({ activeCount: 3, state: 'lfm' });

    await deactivateUser(testApp, gone.userId);
    await banUser(testApp, banned.userId);

    const after = (await getGroup(a.token, game.id)).body as LfgGroupDetailDto;
    expect(after).toMatchObject({ activeCount: 1, state: 'lfg' });
    expect(after.members.map((m) => m.userId)).toEqual([a.userId]);

    const summary = (await getGroups(a.token)).body as LfgGroupSummaryDto[];
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ activeCount: 1, state: 'lfg' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — withdraw
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /lfg/:gameId', () => {
  it("marks the caller's intent cleared and never touches anyone else's", async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Withdraw Game');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);

    const res = await testApp.request
      .delete(`/lfg/${game.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);

    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'cleared',
    );
    expect((await readIntent(testApp, b.userId, game.id))!.status).toBe(
      'active',
    );
    expect((await getGroup(b.token, game.id)).body).toMatchObject({
      activeCount: 1,
      state: 'lfg',
    });
  });

  it('404s when the caller holds no active intent for the game', async () => {
    const [a] = await members('alpha');
    const held = await createGame(testApp, 'Held Game');
    const notHeld = await createGame(testApp, 'Nothing To Withdraw');
    await postIntent(a.token, held.id);

    const missing = await testApp.request
      .delete(`/lfg/${notHeld.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(missing.status).toBe(404);

    // Positive control: the same route returns 204 where an intent IS held,
    // so the 404 above proves the lookup rather than an unmounted route.
    const held204 = await testApp.request
      .delete(`/lfg/${held.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(held204.status).toBe(204);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC10 — hearted cold-start read
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /lfg/hearted', () => {
  it('lists manually hearted games without an own intent, and writes nothing', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const wanted = await createGame(testApp, 'Wanted Game');
    const alreadyPosted = await createGame(testApp, 'Already Posted Game');
    const fromSteam = await createGame(testApp, 'Steam Import Game');
    await heartGame(testApp, a.userId, wanted.id);
    await heartGame(testApp, a.userId, alreadyPosted.id);
    await heartGame(testApp, a.userId, fromSteam.id, 'steam_library');
    await postIntent(a.token, alreadyPosted.id);
    await postIntent(b.token, wanted.id);

    const interestsBefore = await countGameInterests(testApp);
    const res = await testApp.request
      .get('/lfg/hearted')
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);

    const rows = res.body as LfgHeartedGameDto[];
    expect(rows.map((r) => r.gameId)).toEqual([wanted.id]);
    expect(rows[0]).toMatchObject({
      gameName: 'Wanted Game',
      activeCount: 1,
    });
    expect(rows[0].heartedAt).toEqual(expect.any(String));
    expect(await countGameInterests(testApp)).toBe(interestsBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC14 — viability signal, exposed but never acted on
// ═══════════════════════════════════════════════════════════════════════════

describe('viability signal', () => {
  it('reports the Co-Optimus threshold and flips isViable only once it is met', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const coop = await createGame(testApp, 'Coop Game', {
      cooptimusOnlineMax: 2,
    });

    await postIntent(a.token, coop.id);
    expect((await getGroup(a.token, coop.id)).body).toMatchObject({
      viabilityThreshold: 2,
      isViable: false,
    });

    await postIntent(b.token, coop.id);
    expect((await getGroup(a.token, coop.id)).body).toMatchObject({
      activeCount: 2,
      viabilityThreshold: 2,
      isViable: true,
    });

    // Nothing is auto-created off the back of viability.
    const events = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.gameId, coop.id));
    expect(events).toHaveLength(0);
  });

  it('never guesses a threshold for a game with no Co-Optimus data', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const unknown = await createGame(testApp, 'Unknown Coop Game', {
      cooptimusOnlineMax: null,
    });
    await postIntent(a.token, unknown.id);
    await postIntent(b.token, unknown.id);

    expect((await getGroup(a.token, unknown.id)).body).toMatchObject({
      activeCount: 2,
      state: 'lfm',
      viabilityThreshold: null,
      isViable: false,
    });
  });
});
