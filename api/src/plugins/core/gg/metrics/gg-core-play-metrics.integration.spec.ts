/**
 * ROK-2187 lane 3b — Core GG intro / hours / top-games / new-games / people /
 * summary against a real database, across the Jan 1 boundary of a non-UTC
 * community tz (America/New_York: the 2026 year starts 2026-01-01T05:00Z).
 * "Previous year" rows sit at Dec 31 23:30 local (04:30Z).
 */
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import { eq } from 'drizzle-orm';
import * as schema from '../../../../drizzle/schema';
import type { GgCardContext } from '../gg-card.registry';
import {
  produceHoursCard,
  produceNewGamesCard,
  produceTopGamesCard,
} from './games.queries';
import { producePeopleCard } from './people.queries';
import { produceIntroCard, produceSummaryCard } from './summary.queries';

const PREV_YEAR = '2026-01-01T04:30:00Z'; // Dec 31 23:30 New York
const JAN1 = '2026-01-01T05:00:00Z'; // Jan 1 00:00 New York
const SHOT = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/a.jpg';
let testApp: TestApp;
let n = 0;

function ctxFor(userId: number): GgCardContext {
  return {
    db: testApp.db,
    userId,
    year: 2026,
    window: { start: new Date(JAN1), end: new Date('2026-12-10T12:00:00Z') },
    tz: 'America/New_York',
  };
}

async function insertUser(name: string, deactivated = false): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${name}`,
        username: name,
        role: 'member',
        deactivatedAt: deactivated ? new Date() : null,
      })
      .returning({ id: schema.users.id }),
    name,
  );
  return u.id;
}

async function insertGame(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase() })
      .returning({ id: schema.games.id }),
    name,
  );
  return g.id;
}

async function insertEvent(
  startIso: string,
  creatorId: number,
): Promise<number> {
  const start = new Date(startIso);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `E ${startIso}`,
        creatorId,
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + 2 * 3600_000)],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return e.id;
}

async function rollup(
  userId: number,
  gameId: number,
  month: string,
  s: number,
): Promise<void> {
  await testApp.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'month',
    periodStart: month,
    totalSeconds: s,
  });
}

async function session(
  userId: number,
  gameId: number,
  at: string,
): Promise<void> {
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'G',
    startedAt: new Date(at),
  });
}

/** Voice from the event start for `minutes`. */
async function voice(
  eventId: number,
  userId: number,
  startIso: string,
  minutes: number,
): Promise<void> {
  n += 1;
  const join = new Date(startIso);
  const leave = new Date(join.getTime() + minutes * 60_000);
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId,
    userId,
    discordUserId: `d-${n}`,
    discordUsername: `v${n}`,
    firstJoinAt: join,
    totalDurationSec: minutes * 60,
    segments: [
      {
        joinAt: join.toISOString(),
        leaveAt: leave.toISOString(),
        durationSec: minutes * 60,
      },
    ],
  });
}

async function signups(eventId: number, userIds: number[]): Promise<void> {
  await testApp.db.insert(schema.eventSignups).values(
    userIds.map((userId) => ({
      eventId,
      userId,
      attendanceStatus: 'attended' as const,
    })),
  );
}

/** me: 2 rolled-up games (+ a December-2025 row), A since last year, B new on Jan 1. */
async function seedPlay(me: number): Promise<{ a: number; b: number }> {
  const a = await insertGame('Alpha');
  const b = await insertGame('Bravo');
  await testApp.db
    .update(schema.games)
    .set({
      screenshots: [SHOT],
      videos: [{ name: 'Trailer', videoId: 'dQw4w9WgXcQ' }],
    })
    .where(eq(schema.games.id, a));
  await rollup(me, a, '2025-12-01', 99_999);
  await rollup(me, a, '2026-01-01', 7200);
  await rollup(me, a, '2026-03-01', 3600);
  await rollup(me, b, '2026-03-01', 3600);
  await session(me, a, PREV_YEAR);
  await session(me, a, '2026-02-01T17:00:00Z'); // noon NY
  await session(me, b, JAN1);
  return { a, b };
}

/** friend: 1 event + 60 min overlap; gone (deactivated): 2 events; old: last year only. */
async function seedPeople(
  me: number,
): Promise<{ friend: number; gone: number }> {
  const friend = await insertUser('gg-friend');
  const gone = await insertUser('gg-gone', true);
  const old = await insertUser('gg-old');
  const e1 = await insertEvent('2026-02-10T01:00:00Z', me);
  const e2 = await insertEvent('2026-04-10T00:00:00Z', me);
  const prev = await insertEvent(PREV_YEAR, me);
  await signups(e1, [me, friend, gone]);
  await signups(e2, [me, gone]);
  await signups(prev, [me, old]);
  await voice(e1, me, '2026-02-10T01:00:00Z', 90);
  await voice(e1, friend, '2026-02-10T01:30:00Z', 60);
  await voice(prev, me, PREV_YEAR, 60);
  await voice(prev, old, PREV_YEAR, 60);
  return { friend, gone };
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Core GG play producers (integration, ROK-2187 lane 3b)', () => {
  it('hours: the year’s monthly rollups only (Dec 2025 row excluded) + night-owl share', async () => {
    const me = await insertUser('gg-me');
    await seedPlay(me);
    expect(await produceHoursCard(ctxFor(me))).toEqual({
      totalSeconds: 14_400,
      gamesPlayed: 2,
      nightOwlShare: 0.5,
    });
  });

  it('top-games: ranked games carry IGDB screenshots + trailer id; month leaders', async () => {
    const me = await insertUser('gg-me');
    const { a, b } = await seedPlay(me);
    const card = await produceTopGamesCard(ctxFor(me));
    expect(card?.games).toEqual([
      {
        gameId: a,
        name: 'Alpha',
        coverUrl: null,
        seconds: 10_800,
        screenshots: [SHOT],
        trailerVideoId: 'dQw4w9WgXcQ',
      },
      {
        gameId: b,
        name: 'Bravo',
        coverUrl: null,
        seconds: 3600,
        screenshots: [],
        trailerVideoId: null,
      },
    ]);
    expect(card?.byMonth.map((m) => [m.month, m.gameId])).toEqual([
      [1, a],
      [3, a],
    ]);
  });

  it('new-games: first played Jan 1 00:00 local counts; Dec 31 23:30 local does not', async () => {
    const me = await insertUser('gg-me');
    const { b } = await seedPlay(me);
    expect(await produceNewGamesCard(ctxFor(me))).toEqual({
      count: 1,
      games: [{ gameId: b, name: 'Bravo', coverUrl: null }],
    });
  });
});

describe('Core GG people + summary producers (integration, ROK-2187 lane 3b)', () => {
  it('people: year-only co-players, deactivated excluded from names but counted', async () => {
    const me = await insertUser('gg-me');
    const { friend } = await seedPeople(me);
    expect(await producePeopleCard(ctxFor(me))).toEqual({
      people: [
        {
          userId: friend,
          displayName: 'gg-friend',
          avatarUrl: null,
          sharedEvents: 1,
          sharedVoiceSeconds: 3600,
        },
      ],
      playedWithCount: 2,
    });
  });

  it('intro + summary always exist; summary reuses the other cards’ numbers', async () => {
    const me = await insertUser('gg-me');
    const { a, b } = await seedPlay(me);
    await seedPeople(me);
    expect((await produceIntroCard(ctxFor(me))).memberSince).toEqual(
      expect.any(String),
    );
    expect(await produceSummaryCard(ctxFor(me))).toEqual({
      eventsAttended: 2,
      hoursPlayedSeconds: 14_400,
      topGames: [
        { gameId: a, name: 'Alpha', coverUrl: null },
        { gameId: b, name: 'Bravo', coverUrl: null },
      ],
      playedWithCount: 2,
      superlative: 'welcome-aboard',
    });
  });

  it('short GG: nothing played → only intro + summary', async () => {
    const ctx = ctxFor(await insertUser('gg-empty'));
    expect(await produceHoursCard(ctx)).toBeNull();
    expect(await produceTopGamesCard(ctx)).toBeNull();
    expect(await produceNewGamesCard(ctx)).toBeNull();
    expect(await producePeopleCard(ctx)).toBeNull();
    expect(await produceSummaryCard(ctx)).toEqual({
      eventsAttended: 0,
      hoursPlayedSeconds: 0,
      topGames: [],
      playedWithCount: 0,
      superlative: 'welcome-aboard',
    });
  });
});
