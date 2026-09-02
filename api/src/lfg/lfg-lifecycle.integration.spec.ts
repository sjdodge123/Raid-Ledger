/**
 * ROK-1451 rework — the write side must honour the SAME liveness predicate the
 * reads do (`status = 'active' AND expires_at > now()`, holder neither
 * deactivated nor banned).
 *
 * Reviewer findings covered here:
 *   H1 / Codex P1-a — `refreshGroupExpiry` resurrected a lapsed intent.
 *   Codex P1-b      — `isGroupParticipant` authorised a stale `converted` row.
 *   Codex P2-a      — `convertGroup` flipped rows no read would have counted.
 *   M1 / Codex P2-c — conversion provenance was never validated.
 *
 * Split out of `lfg.integration.spec.ts`, which is at 697/750 lines. Fixtures
 * come from the shared `lfg.integration.spec-helpers.ts`.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../events/signups.integration.spec-helpers';
import {
  DAY_MS,
  createGame,
  createLineupMatch,
  deactivateUser,
  readIntent,
  readIntentsForGame,
  setExpiresAt,
  type LfgIntentResponseDto,
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

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function convert(token: string, gameId: number, body: object) {
  return testApp.request
    .post(`/lfg/${gameId}/convert`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function getGroup(token: string, gameId: number) {
  return testApp.request
    .get(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${token}`);
}

async function members(...names: string[]) {
  const out: Array<{ userId: number; token: string }> = [];
  for (const name of names) {
    out.push(await createMemberAndLogin(testApp, name, `${name}@test.local`));
  }
  return out;
}

/** Post an intent and immediately push it past its expiry (unswept by cron). */
async function postAndExpire(
  token: string,
  gameId: number,
): Promise<{ id: number; expiresAt: number }> {
  const intent = (await postIntent(token, gameId)).body as LfgIntentResponseDto;
  const expiresAt = new Date(Date.now() - DAY_MS);
  await setExpiresAt(testApp, intent.id, expiresAt);
  return { id: intent.id, expiresAt: expiresAt.getTime() };
}

// ═══════════════════════════════════════════════════════════════════════════
// H1 / Codex P1-a — the +1 refresh must not resurrect an ineligible holder
// ═══════════════════════════════════════════════════════════════════════════

describe('+1 refresh eligibility', () => {
  it('leaves a lapsed-but-unswept intent expired when the group refreshes', async () => {
    const [a, stale, c] = await members('alpha', 'stale', 'charlie');
    const game = await createGame(testApp, 'Refresh Game');
    await postIntent(a.token, game.id);
    const lapsed = await postAndExpire(stale.token, game.id);

    // C is the +1: eligible live count goes 1 -> 2, so the group clock resets.
    expect((await postIntent(c.token, game.id)).status).toBe(201);

    const row = await readIntent(testApp, stale.userId, game.id);
    expect(new Date(row!.expires_at).getTime()).toBe(lapsed.expiresAt);
    expect(row!.status).toBe('active');
    expect((await getGroup(a.token, game.id)).body).toMatchObject({
      activeCount: 2,
      state: 'lfm',
    });
  });

  it('leaves a deactivated holder out of the group refresh', async () => {
    const [a, gone, c] = await members('alpha', 'gone', 'charlie');
    const game = await createGame(testApp, 'Deactivated Refresh Game');
    await postIntent(a.token, game.id);
    const goneIntent = (await postIntent(gone.token, game.id))
      .body as LfgIntentResponseDto;
    const before = new Date(Date.now() + 3 * DAY_MS);
    await setExpiresAt(testApp, goneIntent.id, before);
    await deactivateUser(testApp, gone.userId);

    expect((await postIntent(c.token, game.id)).status).toBe(201);

    const row = await readIntent(testApp, gone.userId, game.id);
    expect(new Date(row!.expires_at).getTime()).toBe(before.getTime());
    expect((await getGroup(a.token, game.id)).body).toMatchObject({
      activeCount: 2,
    });
  });

  it('still refreshes every eligible member on the +1', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Happy Refresh Game');
    const first = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;
    const nearExpiry = new Date(Date.now() + 2 * DAY_MS);
    await setExpiresAt(testApp, first.id, nearExpiry);

    await postIntent(b.token, game.id);

    const row = await readIntent(testApp, a.userId, game.id);
    expect(new Date(row!.expires_at).getTime()).toBeGreaterThan(
      nearExpiry.getTime(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Codex P2-a — conversion flips only rows a read would have counted
// ═══════════════════════════════════════════════════════════════════════════

describe('conversion eligibility', () => {
  it('converts only live, eligible rows and counts only those', async () => {
    const [a, stale, gone] = await members('alpha', 'stale', 'gone');
    const game = await createGame(testApp, 'Selective Convert Game');
    await postIntent(a.token, game.id);
    await postAndExpire(stale.token, game.id);
    await postIntent(gone.token, game.id);
    await deactivateUser(testApp, gone.userId);

    const eventId = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });
    const res = await convert(a.token, game.id, { eventId });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ converted: 1 });
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'converted',
    );
    expect((await readIntent(testApp, stale.userId, game.id))!.status).toBe(
      'active',
    );
    expect((await readIntent(testApp, gone.userId, game.id))!.status).toBe(
      'active',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Codex P1-b — conversion authority does not survive into the NEXT group
// ═══════════════════════════════════════════════════════════════════════════

describe('conversion authority', () => {
  it('403s an old participant whose only row converted into a different target', async () => {
    const [a, b, c] = await members('alpha', 'bravo', 'charlie');
    const game = await createGame(testApp, 'Second Group Game');
    await postIntent(a.token, game.id);
    const firstEvent = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });
    expect(
      (await convert(a.token, game.id, { eventId: firstEvent })).status,
    ).toBe(201);

    // A brand-new group forms for the same game. A is not part of it.
    await postIntent(b.token, game.id);
    await postIntent(c.token, game.id);
    const secondEvent = await createFutureEvent(testApp, adminToken, {
      gameId: game.id,
    });

    expect(
      (await convert(a.token, game.id, { eventId: secondEvent })).status,
    ).toBe(403);
    const rows = await readIntentsForGame(testApp, game.id);
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(2);

    // Positive control: an actual member of the live group can convert it.
    const ok = await convert(b.token, game.id, { eventId: secondEvent });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ converted: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M1 / Codex P2-c — provenance target must exist and belong to the game
// ═══════════════════════════════════════════════════════════════════════════

describe('conversion provenance — missing target', () => {
  it('404s a nonexistent pollId instead of raising an FK 500', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Ghost Poll Game');
    await postIntent(a.token, game.id);

    const res = await convert(a.token, game.id, { pollId: 987654 });
    expect(res.status).toBe(404);
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });

  it('404s a nonexistent eventId', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Ghost Event Game');
    await postIntent(a.token, game.id);

    expect((await convert(a.token, game.id, { eventId: 987654 })).status).toBe(
      404,
    );
  });
});

describe('conversion provenance — mismatched game', () => {
  it('400s an event that belongs to a different game', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Own Game');
    const other = await createGame(testApp, 'Other Game');
    await postIntent(a.token, game.id);
    const foreignEvent = await createFutureEvent(testApp, adminToken, {
      gameId: other.id,
    });

    const res = await convert(a.token, game.id, { eventId: foreignEvent });
    expect(res.status).toBe(400);
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });

  it('400s a poll that belongs to a different game', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Own Poll Game');
    const other = await createGame(testApp, 'Other Poll Game');
    await postIntent(a.token, game.id);
    const foreignPoll = await createLineupMatch(
      testApp,
      testApp.seed.adminUser.id,
      other.id,
    );

    expect(
      (await convert(a.token, game.id, { pollId: foreignPoll })).status,
    ).toBe(400);
  });

  it('accepts a poll for the route game (positive control)', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Matching Poll Game');
    await postIntent(a.token, game.id);
    const pollId = await createLineupMatch(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
    );

    const res = await convert(a.token, game.id, { pollId });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ converted: 1 });
    expect(
      (await readIntent(testApp, a.userId, game.id))!.converted_to_poll_id,
    ).toBe(pollId);
  });
});
