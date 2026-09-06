/**
 * ROK-1479 — LFG "right now": urgency classes, per-row refresh horizons and
 * the 30/60-minute lifecycle, end to end through the real controller.
 *
 * Split out of `lfg.integration.spec.ts` (already 749 lines against a 750-line
 * cap) rather than appended to it — the Lane A table pre-declares this file as
 * the overflow.
 *
 * WHY A SEPARATE FILE MATTERS FOR THE READER: every case here asserts a
 * horizon in MINUTES against a `timestamp` (no zone) column. `minutesFromNow`
 * reads through drizzle, never `db.execute(sql`SELECT *`)`, for the reason the
 * helpers file documents at length — the two paths disagree about what a naive
 * timestamp means and a UTC-6 runner made every raw read 6 hours off.
 *
 * Each `it` carries a MUTATION note naming the single line to revert to make
 * it fail, because an AC-closing test that could never have failed is worse
 * than no test at all.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import {
  LFG_EXPIRY_JOB_NAME,
  createGame,
  countActiveIntents,
  minutesFromNow,
  readIntent,
  setExpiresAt,
  type LfgIntentResponseDto,
  type LfgGroupSummaryDto,
  type LfgGroupDetailDto,
} from './lfg.integration.spec-helpers';
import { LFG_EVENTS } from './lfg.constants';

/** 14 days expressed the way every assertion below measures — in minutes. */
const WEEK_MINUTES = 14 * 24 * 60;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── request wrappers ────────────────────────────────────────────────────────

function postIntent(token: string, gameId: number, extra: object = {}) {
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

/** Create N logged-in members with predictable usernames. */
async function members(...names: string[]) {
  const out: Array<{ userId: number; token: string }> = [];
  for (const name of names) {
    out.push(await createMemberAndLogin(testApp, name, `${name}@test.local`));
  }
  return out;
}

/**
 * Record every LFG lifecycle event emitted while `run` executes.
 *
 * Subscribes and unsubscribes around the call so one test's emits can never
 * leak into another's assertion — the emitter is app-scoped and lives for the
 * whole suite.
 */
async function captureEvents(
  run: () => Promise<void>,
): Promise<Array<{ name: string; payload: unknown }>> {
  const emitter = testApp.app.get(EventEmitter2);
  const seen: Array<{ name: string; payload: unknown }> = [];
  const onReached = (payload: unknown): void => {
    seen.push({ name: LFG_EVENTS.LFM_REACHED, payload });
  };
  const onChanged = (payload: unknown): void => {
    seen.push({ name: LFG_EVENTS.GROUP_CHANGED, payload });
  };
  emitter.on(LFG_EVENTS.LFM_REACHED, onReached);
  emitter.on(LFG_EVENTS.GROUP_CHANGED, onChanged);
  try {
    await run();
  } finally {
    emitter.off(LFG_EVENTS.LFM_REACHED, onReached);
    emitter.off(LFG_EVENTS.GROUP_CHANGED, onChanged);
  }
  return seen;
}

/** Run the expiry sweep for real, through the registered cron job. */
async function fireSweep(): Promise<void> {
  const scheduler = testApp.app.get(SchedulerRegistry, { strict: false });
  await scheduler.getCronJob(LFG_EXPIRY_JOB_NAME).fireOnTick();
}

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — the create schema decides the horizon
// ═══════════════════════════════════════════════════════════════════════════

describe('AC1 — POST /lfg urgency and horizon', () => {
  // MUTATION: delete `.default('week')` from `CreateLfgIntentSchema`
  // (`packages/contract/src/lfg.schema.ts`) and this fails on the VALUE —
  // `urgency` comes back undefined — not on a parse throw.
  it('keeps a body of just gameId on the 14-day week horizon', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');

    const res = await postIntent(a.token, game.id);

    expect(res.status).toBe(201);
    const body = res.body as LfgIntentResponseDto;
    expect(body.urgency).toBe('week');
    expect(body.ttlMinutes).toBeNull();
    expect(minutesFromNow(body.expiresAt)).toBeCloseTo(WEEK_MINUTES, -1);
  });

  // MUTATION: make `resolveIntentHorizon` fall through to `computeExpiresAt`
  // for `now` and this fails reporting 20160 minutes instead of 30.
  it('gives a now request with no ttlMinutes the 30-minute horizon', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');

    const res = await postIntent(a.token, game.id, { urgency: 'now' });

    expect(res.status).toBe(201);
    const body = res.body as LfgIntentResponseDto;
    expect(body).toMatchObject({ urgency: 'now', ttlMinutes: 30 });
    expect(minutesFromNow(body.expiresAt)).toBeCloseTo(30, -1);
  });

  // MUTATION: hard-code `LFG_DEFAULT_NOW_TTL_MINUTES` in `resolveIntentHorizon`
  // instead of reading `opts.ttlMinutes` and this fails 30-vs-60.
  it('honours an explicit 60-minute ttl', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');

    const res = await postIntent(a.token, game.id, {
      urgency: 'now',
      ttlMinutes: 60,
    });

    expect(res.status).toBe(201);
    const body = res.body as LfgIntentResponseDto;
    expect(body).toMatchObject({ urgency: 'now', ttlMinutes: 60 });
    expect(minutesFromNow(body.expiresAt)).toBeCloseTo(60, -1);
  });

  // A2: a ttl alongside `week` is a client bug. Dropping it silently would
  // hand back a 14-day intent the caller believes lapses in an hour.
  // MUTATION: delete the `.superRefine` block and this fails 201-vs-400.
  it('rejects ttlMinutes on a week request with a field error', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');

    const res = await postIntent(a.token, game.id, {
      urgency: 'week',
      ttlMinutes: 60,
    });

    expect(res.status).toBe(400);
    // `BadRequestException(fieldErrors)` returns the object verbatim, but a
    // global filter could re-wrap it under `message`. Unwrap either shape so
    // the assertion is about the FIELD, not the envelope.
    const body = res.body as { message?: unknown };
    expect(body.message ?? res.body).toHaveProperty('ttlMinutes');
    expect(await countActiveIntents(testApp, a.userId, game.id)).toBe(0);
  });

  it('rejects an unknown urgency value', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');

    const res = await postIntent(a.token, game.id, { urgency: 'tonight' });

    expect(res.status).toBe(400);
    expect(await countActiveIntents(testApp, a.userId, game.id)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — a re-heart BUMPS the caller's own row; it never adds a second
// ═══════════════════════════════════════════════════════════════════════════

describe('AC2 — bump, never a second row', () => {
  // MUTATION: make `bumpIntentUrgency` return null before its UPDATE and this
  // fails on the DATE comparison (20160 minutes, not 30), which is the point —
  // the row count would still be 1, so a count-only assertion proves nothing.
  it('shortens the caller own row to the now horizon and answers 200', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');
    const week = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;

    const res = await postIntent(a.token, game.id, {
      urgency: 'now',
      ttlMinutes: 30,
    });

    expect(res.status).toBe(200);
    const body = res.body as LfgIntentResponseDto;
    expect(body.id).toBe(week.id);
    expect(body.urgency).toBe('now');
    expect(await countActiveIntents(testApp, a.userId, game.id)).toBe(1);
    const row = (await readIntent(testApp, a.userId, game.id))!;
    expect(row.urgency).toBe('now');
    expect(row.ttl_minutes).toBe(30);
    expect(minutesFromNow(row.expires_at)).toBeCloseTo(30, -1);
    expect(row.expires_at.getTime()).toBeLessThan(
      new Date(week.expiresAt).getTime(),
    );
  });

  // The reverse direction, which is what makes this a bump rather than a
  // one-way "shorten": going back to week must LENGTHEN the same row.
  // MUTATION: restrict the bump to `opts.urgency === 'now'` and this fails
  // reporting 30 minutes where 20160 was expected.
  it('lengthens the same row back to 14 days when the caller picks week again', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');
    const first = (await postIntent(a.token, game.id, { urgency: 'now' }))
      .body as LfgIntentResponseDto;

    const res = await postIntent(a.token, game.id);

    expect(res.status).toBe(200);
    const body = res.body as LfgIntentResponseDto;
    expect(body.id).toBe(first.id);
    expect(await countActiveIntents(testApp, a.userId, game.id)).toBe(1);
    const row = (await readIntent(testApp, a.userId, game.id))!;
    expect(row.urgency).toBe('week');
    expect(row.ttl_minutes).toBeNull();
    expect(minutesFromNow(row.expires_at)).toBeCloseTo(WEEK_MINUTES, -1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — a now intent lapses out of every READ before the sweep ever runs
// ═══════════════════════════════════════════════════════════════════════════

describe('AC3 — expiry and re-hearting', () => {
  // The load-bearing claim (D5): the reads, not the cron, are the source of
  // truth. If this were false, a 30-minute intent would keep showing for up to
  // a full sweep interval.
  // MUTATION: drop the `gt(expiresAt, now)` term from `liveIntent`
  // (`lfg-query.helpers.ts`) and both reads below come back populated.
  it('drops a lapsed now intent out of GET /lfg and the group read BEFORE the sweep', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');
    const intent = (await postIntent(a.token, game.id, { urgency: 'now' }))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - 60_000));

    const groups = (await getGroups(a.token)).body as LfgGroupSummaryDto[];
    expect(groups.map((g) => g.gameId)).not.toContain(game.id);

    const detail = (await getGroup(a.token, game.id)).body as LfgGroupDetailDto;
    expect(detail.activeCount).toBe(0);
    expect(detail.nowCount).toBe(0);
    expect(detail.members).toEqual([]);
    // Still `active` on disk — the read filtered it, nothing swept it yet.
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
  });

  // MUTATION: replace `expireStaleIntents`'s `expires_at <= now()` with a
  // 14-day literal and this fails on the status ('active', not 'expired').
  it('flips the lapsed row to expired and announces the game exactly once', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');
    const intent = (await postIntent(a.token, game.id, { urgency: 'now' }))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - 60_000));

    const seen = await captureEvents(fireSweep);

    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'expired',
    );
    expect(seen).toEqual([
      {
        name: LFG_EVENTS.GROUP_CHANGED,
        payload: { gameId: game.id, reason: 'expired' },
      },
    ]);
  });

  // Re-hearting after expiry is a genuine INSERT (201): the partial unique
  // index only covers `status='active'`, so the swept row no longer blocks it.
  // MUTATION: make `expireStaleIntents` leave `status` alone and this fails
  // 200-vs-201, because the stale active row would still win the index.
  it('re-hearts into a live row after the sweep', async () => {
    const [a] = await members('alpha');
    const game = await createGame(testApp, 'Deep Rock');
    const intent = (await postIntent(a.token, game.id, { urgency: 'now' }))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - 60_000));
    await fireSweep();

    const res = await postIntent(a.token, game.id, { urgency: 'now' });

    expect(res.status).toBe(201);
    const body = res.body as LfgIntentResponseDto;
    expect(body.urgency).toBe('now');
    expect(minutesFromNow(body.expiresAt)).toBeCloseTo(30, -1);
    expect(await countActiveIntents(testApp, a.userId, game.id)).toBe(1);
    const detail = (await getGroup(a.token, game.id)).body as LfgGroupDetailDto;
    expect(detail.activeCount).toBe(1);
    expect(detail.nowCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — the LFM threshold treats a now group exactly like a weekly one
// ═══════════════════════════════════════════════════════════════════════════

describe('AC4 — LFM_REACHED is urgency-blind', () => {
  // MUTATION: add an urgency term to `groupColumns`' `activeCount` (e.g. count
  // only `week` rows) and this fails — no LFM_REACHED is emitted at all.
  it('emits exactly one LFM_REACHED for two now hands, and no GROUP_CHANGED', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Deep Rock', {
      cooptimusOnlineMax: 2,
    });
    await postIntent(a.token, game.id, { urgency: 'now' });

    let second!: LfgIntentResponseDto;
    const seen = await captureEvents(async () => {
      const res = await postIntent(b.token, game.id, { urgency: 'now' });
      expect(res.status).toBe(201);
      second = res.body as LfgIntentResponseDto;
    });

    expect(seen).toEqual([
      {
        name: LFG_EVENTS.LFM_REACHED,
        // Both hands posted `{urgency:'now'}` with no ttl, so the completing
        // row stores the 30-minute default and the payload quotes it — this
        // is the number the affinity DM prints (D10).
        payload: {
          gameId: game.id,
          activeCount: 2,
          urgency: 'now',
          ttlMinutes: 30,
        },
      },
    ]);
    expect(second.group).toMatchObject({
      activeCount: 2,
      nowCount: 2,
      state: 'lfm',
      isViable: true,
    });
  });

  // D2: `activeCount` counts BOTH classes. A mixed group crossing the
  // threshold is the case a split counter would silently break.
  // MUTATION: make `activeCount` count only `now` rows and this fails with no
  // LFM_REACHED and `activeCount: 1`.
  it('crosses the threshold on a mixed group and reports nowCount 1', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Deep Rock', {
      cooptimusOnlineMax: 2,
    });
    await postIntent(a.token, game.id, { urgency: 'now', ttlMinutes: 60 });

    let second!: LfgIntentResponseDto;
    const seen = await captureEvents(async () => {
      second = (await postIntent(b.token, game.id))
        .body as LfgIntentResponseDto;
    });

    expect(seen).toEqual([
      {
        name: LFG_EVENTS.LFM_REACHED,
        // The WEEKLY hand completed the pair, so the payload reports its own
        // (absent) horizon — not the 60 the now member is sitting on.
        payload: {
          gameId: game.id,
          activeCount: 2,
          urgency: 'week',
          ttlMinutes: null,
        },
      },
    ]);
    expect(second.group).toMatchObject({
      activeCount: 2,
      nowCount: 1,
      isViable: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC8 — the +1 refresh moves each row on ITS OWN horizon (operator ruling A3)
// ═══════════════════════════════════════════════════════════════════════════

describe('AC8 — per-row refresh horizons', () => {
  // This is the whole feature. One blanket UPDATE writing 14 days across the
  // group turns every "right now" intent into a weekly one, and nothing else
  // in the suite would notice.
  // MUTATION: collapse `refreshGroupExpiry` back to a single UPDATE with
  // `computeExpiresAt(now)` and this fails reporting 20160 minutes on a row
  // that asked for 60.
  it('refreshes the week row to 14 days and the now row to its own TTL only', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Deep Rock');
    const now = (
      await postIntent(a.token, game.id, {
        urgency: 'now',
        ttlMinutes: 60,
      })
    ).body as LfgIntentResponseDto;
    // Wind the now row down so a refresh is OBSERVABLE: without this the row
    // would sit at ~60 minutes either way and the assertion could not fail.
    await setExpiresAt(testApp, now.id, new Date(Date.now() + 5 * 60_000));

    const plusOne = (await postIntent(b.token, game.id))
      .body as LfgIntentResponseDto;

    expect(plusOne.group.activeCount).toBe(2);
    expect(plusOne.group.nowCount).toBe(1);
    const nowRow = (await readIntent(testApp, a.userId, game.id))!;
    const weekRow = (await readIntent(testApp, b.userId, game.id))!;
    expect(minutesFromNow(nowRow.expires_at)).toBeCloseTo(60, -1);
    expect(minutesFromNow(weekRow.expires_at)).toBeCloseTo(WEEK_MINUTES, -1);
  });

  // AC8(b): the ROK-1451 weekly cohort behaviour is untouched — a +1 still
  // pushes an existing week row back out to a full 14 days.
  // MUTATION: drop the `urgency = 'week'` UPDATE from `refreshGroupExpiry` and
  // this fails reporting the wound-down 5 minutes.
  it('still refreshes a weekly cohort to a full 14 days', async () => {
    const [a, b] = await members('alpha', 'bravo');
    const game = await createGame(testApp, 'Deep Rock');
    const first = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, first.id, new Date(Date.now() + 5 * 60_000));

    await postIntent(b.token, game.id);

    const row = (await readIntent(testApp, a.userId, game.id))!;
    expect(minutesFromNow(row.expires_at)).toBeCloseTo(WEEK_MINUTES, -1);
  });
});
