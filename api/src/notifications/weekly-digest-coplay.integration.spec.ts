/**
 * ROK-2063 — the digest's co-play read against a real database. A game is
 * "played together" when 2+ active guild members' `game_activity_sessions`
 * overlap by ≥ 15 minutes inside the window, or an attended event for it had
 * 2+ attended (active-member) signups. Solo play, short overlaps, sessions
 * outside the window and non-members never qualify.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import {
  CO_PLAY_MIN_OVERLAP_MINUTES,
  fetchCoPlayGames,
  type CoPlayWindow,
} from './weekly-digest-coplay.queries';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface UserOpts {
  seenInGuild?: boolean;
  deactivated?: boolean;
  /** Sets the `show_activity = false` preference. */
  optedOut?: boolean;
}

let seq = 0;

async function seedUser(t: TestApp, opts: UserOpts = {}): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await t.db
      .insert(schema.users)
      .values({
        discordId: `d:cp-${seq}`,
        username: `cp-${seq}`,
        role: 'member',
        guildMemberSeenAt: opts.seenInGuild === false ? null : new Date(),
        ...(opts.deactivated ? { deactivatedAt: new Date() } : {}),
      })
      .returning(),
    'user',
  );
  if (opts.optedOut) {
    await t.db
      .insert(schema.userPreferences)
      .values({ userId: u.id, key: 'show_activity', value: false });
  }
  return u.id;
}

async function seedGame(t: TestApp, name: string): Promise<number> {
  const [g] = nonEmpty(
    await t.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
      .returning(),
    'game',
  );
  return g.id;
}

/** A session `startAgo` ms before `now`, ending `endAgo` ms before it (null = open). */
async function seedSession(
  t: TestApp,
  now: Date,
  userId: number,
  gameId: number,
  startAgo: number,
  endAgo: number | null,
): Promise<void> {
  await t.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'game',
    startedAt: new Date(now.getTime() - startAgo),
    endedAt: endAgo === null ? null : new Date(now.getTime() - endAgo),
  });
}

/** An event for `gameId` that ended `endAgo` ms ago, every user `attended`. */
async function seedEvent(
  t: TestApp,
  now: Date,
  gameId: number,
  endAgo: number,
  attendees: number[],
): Promise<void> {
  const creator = nonEmpty(attendees, 'attendees')[0];
  const end = new Date(now.getTime() - endAgo);
  const [e] = nonEmpty(
    await t.db
      .insert(schema.events)
      .values({
        title: `cp event ${String(endAgo)}`,
        creatorId: creator,
        gameId,
        duration: [new Date(end.getTime() - 2 * HOUR), end],
      })
      .returning(),
    'event',
  );
  for (const userId of attendees) {
    await t.db
      .insert(schema.eventSignups)
      .values({ eventId: e.id, userId, attendanceStatus: 'attended' });
  }
}

/** The digest's own week: the seven days ending at `now`. */
function weekEnding(now: Date): CoPlayWindow {
  return { start: new Date(now.getTime() - 7 * DAY), end: now };
}

describe('fetchCoPlayGames — sessions (ROK-2063, integration)', () => {
  let testApp: TestApp;
  let now: Date;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  beforeEach(() => {
    now = new Date();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  const read = () => fetchCoPlayGames(testApp.db, weekEnding(now), { now });

  it('uses a 15-minute minimum overlap', () => {
    expect(CO_PLAY_MIN_OVERLAP_MINUTES).toBe(15);
  });

  it('leaves out a game only one member played', async () => {
    const solo = await seedUser(testApp);
    const game = await seedGame(testApp, 'Solo Quest');
    await seedSession(testApp, now, solo, game, 2 * DAY, 2 * DAY - 3 * HOUR);
    await seedSession(testApp, now, solo, game, 1 * DAY, 1 * DAY - 3 * HOUR);
    await expect(read()).resolves.toEqual([]);
  });

  it('leaves out two members who overlapped for only 10 minutes', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const game = await seedGame(testApp, 'Short Overlap');
    await seedSession(testApp, now, a, game, 2 * DAY, 2 * DAY - 60 * MIN);
    await seedSession(
      testApp,
      now,
      b,
      game,
      2 * DAY - 50 * MIN,
      2 * DAY - 120 * MIN,
    );
    await expect(read()).resolves.toEqual([]);
  });

  it('includes two members who overlapped for 20 minutes, players = 2', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const game = await seedGame(testApp, 'Valheim');
    await seedSession(testApp, now, a, game, 2 * DAY, 2 * DAY - 60 * MIN);
    await seedSession(
      testApp,
      now,
      b,
      game,
      2 * DAY - 40 * MIN,
      2 * DAY - 120 * MIN,
    );
    await expect(read()).resolves.toEqual([
      { gameId: game, name: 'Valheim', slug: 'valheim', players: 2 },
    ]);
  });

  it('counts only the members who overlapped: three played, two together', async () => {
    const [a, b, c] = [
      await seedUser(testApp),
      await seedUser(testApp),
      await seedUser(testApp),
    ];
    const game = await seedGame(testApp, 'Trio');
    await seedSession(testApp, now, a, game, 3 * DAY, 3 * DAY - 2 * HOUR);
    await seedSession(
      testApp,
      now,
      b,
      game,
      3 * DAY - HOUR,
      3 * DAY - 3 * HOUR,
    );
    await seedSession(testApp, now, c, game, 1 * DAY, 1 * DAY - 2 * HOUR);
    const games = await read();
    expect(games.map((g) => [g.gameId, g.players])).toEqual([[game, 2]]);
  });

  it('treats an open session (ended_at null) as running until now', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const game = await seedGame(testApp, 'Still Playing');
    await seedSession(testApp, now, a, game, 2 * HOUR, null);
    await seedSession(testApp, now, b, game, 30 * MIN, null);
    const games = await read();
    expect(games.map((g) => [g.gameId, g.players])).toEqual([[game, 2]]);
  });

  it('ignores co-play outside the window, including overlap that reached 15 min before it', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const old = await seedGame(testApp, 'Last Month');
    const edge = await seedGame(testApp, 'Edge Case');
    await seedSession(testApp, now, a, old, 20 * DAY, 20 * DAY - 2 * HOUR);
    await seedSession(testApp, now, b, old, 20 * DAY, 20 * DAY - 2 * HOUR);
    // 2 h together, but the 15-minute mark falls before the window starts.
    const start = 7 * DAY + 110 * MIN;
    const end = 7 * DAY - 10 * MIN;
    await seedSession(testApp, now, a, edge, start, end);
    await seedSession(testApp, now, b, edge, start, end);
    await expect(read()).resolves.toEqual([]);
  });

  it('does not let a non-member or a deactivated user complete a pair', async () => {
    const member = await seedUser(testApp);
    const guest = await seedUser(testApp, { seenInGuild: false });
    const gone = await seedUser(testApp, { deactivated: true });
    const game = await seedGame(testApp, 'Lonely');
    for (const u of [member, guest, gone]) {
      await seedSession(testApp, now, u, game, 2 * DAY, 2 * DAY - 2 * HOUR);
    }
    await expect(read()).resolves.toEqual([]);
  });

  it('lets an opted-out member complete a pair but counts only visible players', async () => {
    const ann = await seedUser(testApp);
    const hidden = await seedUser(testApp, { optedOut: true });
    const hidden2 = await seedUser(testApp, { optedOut: true });
    const shared = await seedGame(testApp, 'Shared');
    const secret = await seedGame(testApp, 'Secret');
    for (const u of [ann, hidden]) {
      await seedSession(testApp, now, u, shared, 2 * DAY, 2 * DAY - HOUR);
    }
    // Only opted-out members: qualifies, but 0 visible players → not listed.
    for (const u of [hidden, hidden2]) {
      await seedSession(testApp, now, u, secret, 3 * DAY, 3 * DAY - HOUR);
    }
    await expect(read()).resolves.toEqual([
      { gameId: shared, name: 'Shared', slug: 'shared', players: 1 },
    ]);
  });

  it('caps an open session at the window end when the window ends before now', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const [c, d] = [await seedUser(testApp), await seedUser(testApp)];
    const capped = await seedGame(testApp, 'Capped');
    const control = await seedGame(testApp, 'Control');
    // Both open; only 10 (capped) vs 30 (control) minutes fall before `end`.
    for (const u of [a, b]) {
      await seedSession(testApp, now, u, capped, DAY + 10 * MIN, null);
    }
    for (const u of [c, d]) {
      await seedSession(testApp, now, u, control, DAY + 30 * MIN, null);
    }
    const window = {
      start: new Date(now.getTime() - 7 * DAY),
      end: new Date(now.getTime() - DAY),
    };
    const games = await fetchCoPlayGames(testApp.db, window, { now });
    expect(games.map((g) => [g.gameId, g.players])).toEqual([[control, 2]]);
  });

  it('never pairs a member with their own overlapping sessions', async () => {
    const a = await seedUser(testApp);
    const game = await seedGame(testApp, 'Two Clients');
    await seedSession(testApp, now, a, game, 2 * DAY, 2 * DAY - 2 * HOUR);
    await seedSession(
      testApp,
      now,
      a,
      game,
      2 * DAY - HOUR,
      2 * DAY - 3 * HOUR,
    );
    await expect(read()).resolves.toEqual([]);
  });
});

describe('fetchCoPlayGames — window-start credit (ROK-2063, integration)', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // Overlap credited to the window holding its 15th minute (`from + 15 min`).
  it('counts a straddling overlap once, in the window its 15th minute falls in', async () => {
    const now = new Date();
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const cases = [
      ['Never Reached', 10 * MIN, -4 * MIN], // 14 min in all
      ['Straddle', 10 * MIN, -10 * MIN], // reaches 15 min 5 min inside
      ['Before Window', 30 * MIN, 5 * MIN], // reaches 15 min before it
    ] as const;
    const ids = new Map<string, number>();
    for (const [name, before, after] of cases) {
      const game = await seedGame(testApp, name);
      ids.set(name, game);
      for (const u of [a, b]) {
        await seedSession(
          testApp,
          now,
          u,
          game,
          7 * DAY + before,
          7 * DAY + after,
        );
      }
    }
    const games = await fetchCoPlayGames(testApp.db, weekEnding(now), { now });
    expect(games.map((g) => [g.gameId, g.players])).toEqual([
      [ids.get('Straddle'), 2],
    ]);
    const prior = {
      start: new Date(now.getTime() - 14 * DAY),
      end: new Date(now.getTime() - 7 * DAY),
    };
    const earlier = await fetchCoPlayGames(testApp.db, prior, { now });
    expect(earlier.map((g) => g.gameId)).toEqual([ids.get('Before Window')]);
  });
});

describe('fetchCoPlayGames — events (ROK-2063, integration)', () => {
  let testApp: TestApp;
  let now: Date;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  beforeEach(() => {
    now = new Date();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  const read = () => fetchCoPlayGames(testApp.db, weekEnding(now), { now });

  it('includes a game whose attended event had 2 attendees', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const game = await seedGame(testApp, 'Raid Night');
    await seedEvent(testApp, now, game, 2 * DAY, [a, b]);
    await expect(read()).resolves.toEqual([
      { gameId: game, name: 'Raid Night', slug: 'raid-night', players: 2 },
    ]);
  });

  it('leaves out a game whose event had a single attendee', async () => {
    const a = await seedUser(testApp);
    const game = await seedGame(testApp, 'Party Of One');
    await seedEvent(testApp, now, game, 2 * DAY, [a]);
    await expect(read()).resolves.toEqual([]);
  });

  it('does not count a deactivated attendee toward the two', async () => {
    const a = await seedUser(testApp);
    const gone = await seedUser(testApp, { deactivated: true });
    const game = await seedGame(testApp, 'Half Party');
    await seedEvent(testApp, now, game, 2 * DAY, [a, gone]);
    await expect(read()).resolves.toEqual([]);
  });

  it('ranks by players, most first', async () => {
    const [a, b, c] = [
      await seedUser(testApp),
      await seedUser(testApp),
      await seedUser(testApp),
    ];
    const duo = await seedGame(testApp, 'Duo Game');
    const trio = await seedGame(testApp, 'Trio Game');
    await seedEvent(testApp, now, duo, 2 * DAY, [a, b]);
    await seedEvent(testApp, now, trio, 3 * DAY, [a, b, c]);
    const games = await read();
    expect(games.map((g) => [g.gameId, g.players])).toEqual([
      [trio, 3],
      [duo, 2],
    ]);
  });
});

describe('fetchCoPlayGames — event window boundary (integration)', () => {
  let testApp: TestApp;
  let now: Date;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  beforeEach(() => {
    now = new Date();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  const read = () => fetchCoPlayGames(testApp.db, weekEnding(now), { now });

  // Half-open [start, end): an event ending exactly on the boundary belongs to
  // the NEXT week only — `<= end` counted it in two consecutive digests.
  it('credits an event ending exactly at the window end to the next week only', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const edge = await seedGame(testApp, 'Boundary Raid');
    await seedEvent(testApp, now, edge, 0, [a, b]);
    expect((await read()).map((g) => g.gameId)).toEqual([]);
    const next = { start: now, end: new Date(now.getTime() + 7 * DAY) };
    const following = await fetchCoPlayGames(testApp.db, next, { now });
    expect(following.map((g) => g.gameId)).toEqual([edge]);
  });

  it('counts an event ending one minute before the window end', async () => {
    const [a, b] = [await seedUser(testApp), await seedUser(testApp)];
    const game = await seedGame(testApp, 'Just Inside');
    await seedEvent(testApp, now, game, MIN, [a, b]);
    expect((await read()).map((g) => g.gameId)).toEqual([game]);
  });
});
