/**
 * ROK-1463 — integration coverage for the three LFG group-page reads:
 *   GET /lfg/:gameId/overlap      (§A "When everyone's free")
 *   GET /lfg/:gameId/history      (§B "Played here before")
 *   GET /lfg/:gameId/suggestions  (§C "Might want in")
 *
 * TDD: none of these routes exist yet, so every test here fails on a real
 * assertion (Nest 404s an unknown sub-route under `/lfg/:gameId`) rather than
 * on module resolution — this file imports no `./lfg.*` implementation module.
 * Every test asserts the 200 FIRST via `readOk`, so the pre-implementation
 * failure is a crisp `Expected: 200 / Received: 404` rather than a downstream
 * `undefined is not iterable`.
 *
 * Run with `TZ=UTC`: the fixtures write naive `timestamp` / `date` / `tsrange`
 * columns whose meaning is UTC by app convention.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createPastEvent,
  signupViaDb,
} from '../events/signups.integration.spec-helpers';
import {
  DAY_MS,
  addQuickPlayParticipant,
  banUser,
  countGameInterests,
  createGame,
  createLineupMatch,
  createQuickPlayEvent,
  deactivateUser,
  heartGame,
  readIntentsForGame,
  setExpiresAt,
  type LfgIntentResponseDto,
} from './lfg.integration.spec-helpers';
import {
  HISTORY_CAP,
  HOUR_MS,
  ISO_WITH_OFFSET,
  OVERLAP_HORIZON_DAYS,
  OVERLAP_WINDOW_CAP,
  SUGGESTIONS_CAP,
  addAbsence,
  addAvailabilityRange,
  atUtcHour,
  byId,
  createPlainUser,
  gridDayOfWeek,
  markAttended,
  setGameTimeOverride,
  setGameTimeTemplate,
  setShowActivity,
  suppressInterest,
  utcDateOnly,
  utcDayOffset,
  windowStarts,
  type LfgHistoryEntryDto,
  type LfgHistoryResponseDto,
  type LfgOverlapResponseDto,
  type LfgSuggestionDto,
  type LfgSuggestionsResponseDto,
} from './lfg-reads.integration.spec-helpers';

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

const authed = (path: string, token: string) =>
  testApp.request.get(path).set('Authorization', `Bearer ${token}`);

/** Await a read, assert it answered 200, and hand back its typed body. */
async function readOk<T>(pending: ReturnType<typeof authed>): Promise<T> {
  const res = await pending;
  expect(res.status).toBe(200);
  return res.body as T;
}

const overlapOf = (token: string, gameId: number) =>
  readOk<LfgOverlapResponseDto>(authed(`/lfg/${gameId}/overlap`, token));
const historyOf = (token: string, gameId: number) =>
  readOk<LfgHistoryResponseDto>(authed(`/lfg/${gameId}/history`, token));
const suggestionsOf = (token: string, gameId: number) =>
  readOk<LfgSuggestionsResponseDto>(
    authed(`/lfg/${gameId}/suggestions`, token),
  );

let memberSeq = 0;

/** A member with a usable JWT. Sequenced so names never collide in a test. */
async function member(name: string) {
  memberSeq += 1;
  return createMemberAndLogin(
    testApp,
    `${name}${memberSeq}`,
    `${name}${memberSeq}@test.local`,
  );
}

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

/** A past scheduled event for `gameId`, ending `hoursAgo` ago, 3h long. */
async function pastEvent(
  gameId: number | null,
  creatorId: number,
  hoursAgo: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const end = new Date(Date.now() - hoursAgo * HOUR_MS);
  const start = new Date(end.getTime() - 3 * HOUR_MS);
  return createPastEvent(testApp, creatorId, {
    gameId,
    title: `Past ${hoursAgo}h`,
    duration: [start, end] as [Date, Date],
    ...overrides,
  });
}

/** A past event the user signed up for AND was marked `attended` on. */
async function attendedEvent(
  gameId: number,
  userId: number,
  hoursAgo = 72,
): Promise<number> {
  const eventId = await pastEvent(gameId, userId, hoursAgo);
  await signupViaDb(testApp, eventId, userId);
  await markAttended(testApp, eventId, userId);
  return eventId;
}

// ═══════════════════════════════════════════════════════════════════════════
// AC1 / AC2 — GET /lfg/:gameId/overlap
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /lfg/:gameId/overlap', () => {
  /**
   * Two live members sharing a 19:00–21:00 UTC block on the weekday that falls
   * three days out. That weekday recurs ONCE more inside the 14-day horizon
   * (day+10), so the grid legitimately yields two identical candidate windows —
   * `start asc` is what puts the nearer one first.
   */
  async function sharedBlock() {
    const game = await createGame(testApp, 'Overlap Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    const day = utcDayOffset(3);
    const dow = gridDayOfWeek(day);
    await setGameTimeTemplate(testApp, a.userId, dow, [19, 20]);
    await setGameTimeTemplate(testApp, b.userId, dow, [19, 20]);
    return { game, a, b, day, dow };
  }

  it('returns the shared block as the top-ranked full-overlap window', async () => {
    const { game, a, b, day } = await sharedBlock();

    const body = await overlapOf(a.token, game.id);

    expect(body).toMatchObject({
      gameId: game.id,
      memberCount: 2,
      horizonDays: OVERLAP_HORIZON_DAYS,
    });
    expect(body.windows.length).toBeGreaterThan(0);
    expect(body.windows.length).toBeLessThanOrEqual(OVERLAP_WINDOW_CAP);
    const [window] = body.windows;
    expect(new Date(window.start).getTime()).toBe(atUtcHour(day, 19).getTime());
    expect(new Date(window.end).getTime()).toBe(atUtcHour(day, 21).getTime());
    expect(window.availableCount).toBe(2);
    expect(window.totalCount).toBe(2);
    expect([...window.members].sort(byId)).toEqual(
      [a.userId, b.userId].sort(byId),
    );
  });

  it('serialises window bounds as offset-bearing ISO instants', async () => {
    const { game, a } = await sharedBlock();

    const [window] = (await overlapOf(a.token, game.id)).windows;

    expect(window.start).toMatch(ISO_WITH_OFFSET);
    expect(window.end).toMatch(ISO_WITH_OFFSET);
  });

  it('falls back to the best partial coverage when a member has no grid', async () => {
    const { game, a, b, day } = await sharedBlock();
    const c = await member('charlie');
    await postIntent(c.token, game.id);

    const body = await overlapOf(a.token, game.id);

    // C is a live member, so the roster is 3 — but no hour reaches coverage 3,
    // so the read degrades to the maximum coverage of 2 rather than returning
    // nothing. `totalCount` still reports the whole roster.
    expect(body.memberCount).toBe(3);
    const [window] = body.windows;
    expect(window.availableCount).toBe(2);
    expect(window.totalCount).toBe(3);
    expect([...window.members].sort(byId)).toEqual(
      [a.userId, b.userId].sort(byId),
    );
    expect(new Date(window.start).getTime()).toBe(atUtcHour(day, 19).getTime());
  });

  it('drops an hour a member blocked with a date override', async () => {
    const { game, a, day } = await sharedBlock();

    await setGameTimeOverride(
      testApp,
      a.userId,
      utcDateOnly(day),
      19,
      'blocked',
    );

    const starts = windowStarts((await overlapOf(a.token, game.id)).windows);
    expect(starts).not.toContain(atUtcHour(day, 19).getTime());
    // 20:00 survives on the overridden day; the day+10 recurrence is untouched.
    expect(starts).toContain(atUtcHour(day, 20).getTime());
  });

  it('drops every hour on a day covered by an absence', async () => {
    const { game, a, day } = await sharedBlock();

    await addAbsence(testApp, a.userId, utcDateOnly(day), utcDateOnly(day));

    const { windows } = await overlapOf(a.token, game.id);
    for (const window of windows) {
      expect(new Date(window.start).toISOString().slice(0, 10)).not.toBe(
        utcDateOnly(day),
      );
    }
    expect(windowStarts(windows)).toContain(
      atUtcHour(utcDayOffset(10), 19).getTime(),
    );
  });

  it('adds an hour supplied only by an `available` tsrange row', async () => {
    const game = await createGame(testApp, 'Tsrange Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    const day = utcDayOffset(3);
    const dow = gridDayOfWeek(day);
    await setGameTimeTemplate(testApp, a.userId, dow, [19, 20]);
    await setGameTimeTemplate(testApp, b.userId, dow, [19]);

    await addAvailabilityRange(
      testApp,
      b.userId,
      atUtcHour(day, 20).toISOString(),
      atUtcHour(day, 21).toISOString(),
      'available',
    );

    // Without the tsrange row the only shared hour is 19:00. With it the pair
    // shares 19:00–21:00, which outranks every 1-hour recurrence on length.
    const [window] = (await overlapOf(a.token, game.id)).windows;
    expect(new Date(window.start).getTime()).toBe(atUtcHour(day, 19).getTime());
    expect(new Date(window.end).getTime()).toBe(atUtcHour(day, 21).getTime());
    expect(window.availableCount).toBe(2);
  });

  /**
   * W2 / Codex P2-a — `availability.game_id` scopes a row to ONE game. The
   * pair shares 19:00 from the grid; the extra 20:00 hour exists only as a
   * tsrange row, so whether the window is one or two hours long is exactly
   * whether that row counted.
   */
  async function scopedRangeGame(scope: number | null) {
    const game = await createGame(testApp, 'Scoped Range Game');
    const other = await createGame(testApp, 'Some Other Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    const day = utcDayOffset(3);
    const dow = gridDayOfWeek(day);
    await setGameTimeTemplate(testApp, a.userId, dow, [19, 20]);
    await setGameTimeTemplate(testApp, b.userId, dow, [19]);
    await addAvailabilityRange(
      testApp,
      b.userId,
      atUtcHour(day, 20).toISOString(),
      atUtcHour(day, 21).toISOString(),
      'available',
      scope === null ? null : scope === -1 ? other.id : game.id,
    );
    return { game, a, day };
  }

  it('ignores an `available` row scoped to a DIFFERENT game', async () => {
    const { game, a, day } = await scopedRangeGame(-1);

    const [window] = (await overlapOf(a.token, game.id)).windows;

    expect(new Date(window.start).getTime()).toBe(atUtcHour(day, 19).getTime());
    expect(new Date(window.end).getTime()).toBe(atUtcHour(day, 20).getTime());
  });

  it('honours an `available` row scoped to THIS game', async () => {
    const { game, a, day } = await scopedRangeGame(1);

    const [window] = (await overlapOf(a.token, game.id)).windows;

    expect(new Date(window.start).getTime()).toBe(atUtcHour(day, 19).getTime());
    expect(new Date(window.end).getTime()).toBe(atUtcHour(day, 21).getTime());
  });

  it('leaves an expired intent holder out of the roster', async () => {
    const { game, a, b, dow } = await sharedBlock();
    const c = await member('charlie');
    const intent = (await postIntent(c.token, game.id))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - DAY_MS));
    await setGameTimeTemplate(testApp, c.userId, dow, [19, 20]);

    const body = await overlapOf(a.token, game.id);

    expect(body.memberCount).toBe(2);
    expect([...body.windows[0].members].sort(byId)).toEqual(
      [a.userId, b.userId].sort(byId),
    );
  });

  it('returns no windows when the group has fewer than two live members', async () => {
    const game = await createGame(testApp, 'Lonely Game');
    const a = await member('alpha');
    await postIntent(a.token, game.id);
    const day = utcDayOffset(3);
    await setGameTimeTemplate(testApp, a.userId, gridDayOfWeek(day), [19, 20]);

    const body = await overlapOf(a.token, game.id);

    expect(body).toMatchObject({ memberCount: 1, windows: [] });
  });

  it('caps the response at two windows', async () => {
    const game = await createGame(testApp, 'Busy Grid Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    for (const offset of [2, 3, 4]) {
      const dow = gridDayOfWeek(utcDayOffset(offset));
      await setGameTimeTemplate(testApp, a.userId, dow, [19]);
      await setGameTimeTemplate(testApp, b.userId, dow, [19]);
    }

    const body = await overlapOf(a.token, game.id);

    // Six candidate hours (3 weekdays × 2 recurrences), none consecutive.
    expect(body.windows).toHaveLength(OVERLAP_WINDOW_CAP);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — GET /lfg/:gameId/history
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /lfg/:gameId/history', () => {
  it('lists a scheduled event and a Quick Play session, newest first', async () => {
    const game = await createGame(testApp, 'History Game');
    const a = await member('alpha');
    const older = await pastEvent(game.id, a.userId, 48, { title: 'Old Raid' });
    await signupViaDb(testApp, older, a.userId);
    await markAttended(testApp, older, a.userId);
    const newer = await createQuickPlayEvent(
      testApp,
      a.userId,
      game.id,
      new Date(Date.now() - 5 * HOUR_MS),
      { title: 'Quick Play', adHocStatus: 'ended' },
    );
    await addQuickPlayParticipant(testApp, newer, a.userId);

    const body = await historyOf(a.token, game.id);

    expect(body.gameId).toBe(game.id);
    expect(body.entries.map((e) => e.eventId)).toEqual([newer, older]);
    expect(body.entries[0]).toMatchObject({
      isAdHoc: true,
      title: 'Quick Play',
      attendedCount: 1,
      durationMinutes: 120,
    });
    expect(body.entries[0].participantIds).toEqual([a.userId]);
    expect(body.entries[0].startedAt).toMatch(ISO_WITH_OFFSET);
    expect(body.entries[0].endedAt).toMatch(ISO_WITH_OFFSET);
    expect(body.entries[1]).toMatchObject({
      isAdHoc: false,
      title: 'Old Raid',
      attendedCount: 1,
      signedUpCount: 1,
      durationMinutes: 180,
    });
    expect(body.entries[1].participantIds).toEqual([a.userId]);
  });

  it('reports signedUpCount with a zero attendedCount when attendance was never recorded', async () => {
    const game = await createGame(testApp, 'No Attendance Game');
    const a = await member('alpha');
    const eventId = await pastEvent(game.id, a.userId, 30);
    await signupViaDb(testApp, eventId, a.userId);

    const [entry] = (await historyOf(a.token, game.id)).entries;

    expect(entry).toMatchObject({
      eventId,
      attendedCount: 0,
      signedUpCount: 1,
    });
  });

  it('excludes cancelled events, rescheduling shells and other games', async () => {
    const game = await createGame(testApp, 'Filtered Game');
    const other = await createGame(testApp, 'Other Game');
    const a = await member('alpha');
    const kept = await attendedEvent(game.id, a.userId, 24);
    const cancelled = await pastEvent(game.id, a.userId, 26, {
      cancelledAt: new Date(),
    });
    const pollId = await createLineupMatch(testApp, a.userId, game.id);
    const rescheduled = await pastEvent(game.id, a.userId, 28, {
      reschedulingPollId: pollId,
    });
    const foreign = await attendedEvent(other.id, a.userId, 22);
    const noGame = await pastEvent(null, a.userId, 20);

    const ids = (await historyOf(a.token, game.id)).entries.map(
      (e) => e.eventId,
    );

    expect(ids).toEqual([kept]);
    expect(ids).not.toContain(cancelled);
    expect(ids).not.toContain(rescheduled);
    expect(ids).not.toContain(foreign);
    expect(ids).not.toContain(noGame);
  });

  /**
   * Codex P2-b — a Quick Play stays `live` / `grace_period` past its nominal
   * `upper(duration)` until the bot finalises it (`ad-hoc-event.helpers.ts`).
   * Reporting one of those as a finished session is reporting a session that
   * is still in progress.
   */
  it('excludes a Quick Play the bot has not finalised', async () => {
    const game = await createGame(testApp, 'Unfinished Quick Play Game');
    const a = await member('alpha');
    const quickPlay = async (hoursAgo: number, status: string) => {
      const id = await createQuickPlayEvent(
        testApp,
        a.userId,
        game.id,
        new Date(Date.now() - hoursAgo * HOUR_MS),
        { title: `QP ${status}`, adHocStatus: status },
      );
      await addQuickPlayParticipant(testApp, id, a.userId);
      return id;
    };
    const ended = await quickPlay(9, 'ended');
    const live = await quickPlay(8, 'live');
    const grace = await quickPlay(7, 'grace_period');

    const ids = (await historyOf(a.token, game.id)).entries.map(
      (e) => e.eventId,
    );

    expect(ids).toEqual([ended]);
    expect(ids).not.toContain(live);
    expect(ids).not.toContain(grace);
  });

  it('excludes an event that has not finished yet', async () => {
    const game = await createGame(testApp, 'Future Game');
    const a = await member('alpha');
    const past = await attendedEvent(game.id, a.userId, 10);
    const start = new Date(Date.now() + DAY_MS);
    await createPastEvent(testApp, a.userId, {
      gameId: game.id,
      title: 'Not yet played',
      duration: [start, new Date(start.getTime() + 3 * HOUR_MS)] as [
        Date,
        Date,
      ],
    });

    const entries: LfgHistoryEntryDto[] = (await historyOf(a.token, game.id))
      .entries;

    expect(entries.map((e) => e.eventId)).toEqual([past]);
  });

  it('counts only eligible participants', async () => {
    const game = await createGame(testApp, 'Eligibility Game');
    const a = await member('alpha');
    const gone = await createPlainUser(testApp, 'gone');
    const eventId = await attendedEvent(game.id, a.userId, 12);
    await signupViaDb(testApp, eventId, gone);
    await markAttended(testApp, eventId, gone);
    await deactivateUser(testApp, gone);

    const [entry] = (await historyOf(a.token, game.id)).entries;

    expect(entry.attendedCount).toBe(1);
    expect(entry.participantIds).toEqual([a.userId]);
  });

  it('caps the response at twenty entries, newest kept', async () => {
    const game = await createGame(testApp, 'Deep History Game');
    const a = await member('alpha');
    const created: number[] = [];
    for (let i = 1; i <= HISTORY_CAP + 2; i += 1) {
      created.push(await pastEvent(game.id, a.userId, i * 4));
    }

    const entries = (await historyOf(a.token, game.id)).entries;

    expect(entries).toHaveLength(HISTORY_CAP);
    expect(entries[0].eventId).toBe(created[0]);
    expect(entries.map((e) => e.eventId)).not.toContain(
      created[HISTORY_CAP + 1],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — GET /lfg/:gameId/suggestions
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /lfg/:gameId/suggestions', () => {
  function index(suggestions: LfgSuggestionDto[]) {
    return new Map(suggestions.map((s) => [s.userId, s]));
  }

  it('carries one reason per qualifying user, and all three when they all apply', async () => {
    const game = await createGame(testApp, 'Suggest Game');
    const caller = await member('caller');
    await postIntent(caller.token, game.id);
    const player = await createPlainUser(testApp, 'player');
    await attendedEvent(game.id, player, 72);
    const owner = await createPlainUser(testApp, 'owner');
    await heartGame(testApp, owner, game.id, 'steam_library');
    const hearter = await createPlainUser(testApp, 'hearter');
    await heartGame(testApp, hearter, game.id, 'manual');
    const everything = await createPlainUser(testApp, 'everything');
    await attendedEvent(game.id, everything, 24);
    await heartGame(testApp, everything, game.id, 'steam_library');
    await heartGame(testApp, everything, game.id, 'manual');

    const body = await suggestionsOf(caller.token, game.id);

    expect(body.gameId).toBe(game.id);
    const byUser = index(body.suggestions);
    expect(byUser.get(player)!.reasons).toEqual(['played']);
    expect(byUser.get(owner)!.reasons).toEqual(['owns']);
    expect(byUser.get(hearter)!.reasons).toEqual(['hearted']);
    expect([...byUser.get(everything)!.reasons].sort()).toEqual([
      'hearted',
      'owns',
      'played',
    ]);
    // Ranking: reason count desc — the three-reason user leads.
    expect(body.suggestions[0].userId).toBe(everything);
    expect(byUser.get(player)!.lastPlayedAt).toMatch(ISO_WITH_OFFSET);
    expect(byUser.get(owner)!.lastPlayedAt).toBeNull();
  });

  it('credits a Quick Play participant with the `played` reason', async () => {
    const game = await createGame(testApp, 'Quick Play Suggest Game');
    const caller = await member('caller');
    const quickPlayer = await createPlainUser(testApp, 'quickplayer');
    const eventId = await createQuickPlayEvent(
      testApp,
      quickPlayer,
      game.id,
      new Date(Date.now() - 6 * HOUR_MS),
      { adHocStatus: 'ended' },
    );
    await addQuickPlayParticipant(testApp, eventId, quickPlayer);

    const body = await suggestionsOf(caller.token, game.id);

    expect(index(body.suggestions).get(quickPlayer)!.reasons).toEqual([
      'played',
    ]);
  });

  /** Codex P2-c — the same lifecycle rule on the `played` signal. */
  it('withholds `played` for a Quick Play the bot has not finalised', async () => {
    const game = await createGame(testApp, 'Unfinished Session Game');
    const caller = await member('caller');
    const stillPlaying = await createPlainUser(testApp, 'stillplaying');
    const eventId = await createQuickPlayEvent(
      testApp,
      stillPlaying,
      game.id,
      new Date(Date.now() - 6 * HOUR_MS),
      { adHocStatus: 'live' },
    );
    await addQuickPlayParticipant(testApp, eventId, stillPlaying);

    const body = await suggestionsOf(caller.token, game.id);

    expect(body.suggestions).toEqual([]);
  });

  it('excludes live intent holders, the caller, and ineligible users', async () => {
    const game = await createGame(testApp, 'Exclusion Game');
    const caller = await member('caller');
    await heartGame(testApp, caller.userId, game.id, 'manual');
    const holder = await member('holder');
    await heartGame(testApp, holder.userId, game.id, 'manual');
    await postIntent(holder.token, game.id);
    const gone = await createPlainUser(testApp, 'gone');
    await heartGame(testApp, gone, game.id, 'manual');
    await deactivateUser(testApp, gone);
    const banned = await createPlainUser(testApp, 'banned');
    await heartGame(testApp, banned, game.id, 'manual');
    await banUser(testApp, banned);
    const keeper = await createPlainUser(testApp, 'keeper');
    await heartGame(testApp, keeper, game.id, 'manual');

    const ids = (await suggestionsOf(caller.token, game.id)).suggestions.map(
      (s) => s.userId,
    );

    expect(ids).toEqual([keeper]);
    expect(ids).not.toContain(holder.userId);
    expect(ids).not.toContain(caller.userId);
    expect(ids).not.toContain(gone);
    expect(ids).not.toContain(banned);
  });

  /**
   * W3 / Codex P2-d — a suppression row records "stop auto-hearting this",
   * which is a statement about the HEART only. The spec scopes the exclusion
   * to `hearted`; an owner who un-hearted still owns the game.
   */
  it('suppresses only the `hearted` reason, never `owns`', async () => {
    const game = await createGame(testApp, 'Suppression Game');
    const caller = await member('caller');
    const owner = await createPlainUser(testApp, 'owner');
    await heartGame(testApp, owner, game.id, 'steam_library');
    await heartGame(testApp, owner, game.id, 'discord');
    await suppressInterest(testApp, owner, game.id);
    const unhearted = await createPlainUser(testApp, 'unhearted');
    await heartGame(testApp, unhearted, game.id, 'discord');
    await suppressInterest(testApp, unhearted, game.id);

    const suggestions = (await suggestionsOf(caller.token, game.id))
      .suggestions;

    const byUser = index(suggestions);
    expect(byUser.get(owner)!.reasons).toEqual(['owns']);
    expect(suggestions.map((s) => s.userId)).not.toContain(unhearted);
  });

  it('drops an expired intent holder back into the suggestion pool', async () => {
    const game = await createGame(testApp, 'Lapsed Holder Game');
    const caller = await member('caller');
    const lapsed = await member('lapsed');
    await heartGame(testApp, lapsed.userId, game.id, 'manual');
    const intent = (await postIntent(lapsed.token, game.id))
      .body as LfgIntentResponseDto;
    await setExpiresAt(testApp, intent.id, new Date(Date.now() - DAY_MS));

    const ids = (await suggestionsOf(caller.token, game.id)).suggestions.map(
      (s) => s.userId,
    );

    expect(ids).toEqual([lapsed.userId]);
  });

  it('hides only the `played` reason for a user who opted out of activity sharing', async () => {
    const game = await createGame(testApp, 'Privacy Game');
    const caller = await member('caller');
    const shy = await createPlainUser(testApp, 'shy');
    await attendedEvent(game.id, shy, 48);
    await heartGame(testApp, shy, game.id, 'manual');
    await setShowActivity(testApp, shy, false);

    const body = await suggestionsOf(caller.token, game.id);

    const suggestion = index(body.suggestions).get(shy);
    expect(suggestion).toBeDefined();
    expect(suggestion!.reasons).toEqual(['hearted']);
    expect(suggestion!.lastPlayedAt).toBeNull();
  });

  it('caps the response at twelve suggestions', async () => {
    const game = await createGame(testApp, 'Popular Game');
    const caller = await member('caller');
    for (let i = 0; i < SUGGESTIONS_CAP + 2; i += 1) {
      const fan = await createPlainUser(testApp, `fan${i}`);
      await heartGame(testApp, fan, game.id, 'manual');
    }

    const body = await suggestionsOf(caller.token, game.id);

    expect(body.suggestions).toHaveLength(SUGGESTIONS_CAP);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 / AC7 — contract shared by all three reads
// ═══════════════════════════════════════════════════════════════════════════

describe('shared read contract', () => {
  const paths = (gameId: number) => [
    `/lfg/${gameId}/overlap`,
    `/lfg/${gameId}/history`,
    `/lfg/${gameId}/suggestions`,
  ];

  it('401s every read without a token', async () => {
    const game = await createGame(testApp, 'Auth Game');

    for (const path of paths(game.id)) {
      expect((await testApp.request.get(path)).status).toBe(401);
    }
  });

  it('404s every read for an unknown game rather than missing the route', async () => {
    for (const path of paths(987654)) {
      const res = await authed(path, adminToken);
      expect(res.status).toBe(404);
      // A missing ROUTE 404s too — Nest's body then reads `Cannot GET …`.
      // The service must raise its own NotFoundException for the game.
      expect(JSON.stringify(res.body)).not.toContain('Cannot GET');
    }
  });

  it('serves a game nobody is looking for without erroring', async () => {
    const game = await createGame(testApp, 'Quiet Game');

    for (const path of paths(game.id)) {
      expect((await authed(path, adminToken)).status).toBe(200);
    }
  });

  it('writes nothing — intent and interest rows are untouched', async () => {
    const game = await createGame(testApp, 'Readonly Game');
    const a = await member('alpha');
    const b = await member('bravo');
    await postIntent(a.token, game.id);
    await postIntent(b.token, game.id);
    await heartGame(testApp, b.userId, game.id, 'manual');
    await attendedEvent(game.id, b.userId, 30);
    const intentsBefore = await readIntentsForGame(testApp, game.id);
    const interestsBefore = await countGameInterests(testApp);

    for (const path of paths(game.id)) {
      expect((await authed(path, a.token)).status).toBe(200);
    }

    expect(await readIntentsForGame(testApp, game.id)).toEqual(intentsBefore);
    expect(await countGameInterests(testApp)).toBe(interestsBefore);
  });

  it('stays readable for a deactivated caller (reads are open, like GET /lfg)', async () => {
    const game = await createGame(testApp, 'Open Read Game');
    const a = await member('alpha');
    await postIntent(a.token, game.id);
    await deactivateUser(testApp, a.userId);

    for (const path of paths(game.id)) {
      expect((await authed(path, a.token)).status).toBe(200);
    }
  });
});
