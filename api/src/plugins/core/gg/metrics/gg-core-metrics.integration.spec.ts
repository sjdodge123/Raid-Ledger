/**
 * ROK-2187 lane 3a — Core GG cards against a real database, across the Jan 1
 * boundary of a non-UTC community tz (America/New_York, so the 2026 year
 * starts at 2026-01-01T05:00Z; compute time — the window end — is
 * 2026-12-10T12:00Z). Every seeded "previous year" row sits at Dec 31 23:30
 * local (04:30Z), which a UTC window would wrongly include.
 */
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import type { GgCardContext } from '../gg-card.registry';
import {
  produceEventsCard,
  produceOnTimeCard,
  produceRhythmCard,
} from './events.queries';
import { produceHubsCard } from './hubs.queries';
import { produceSuperlativeCard } from './superlatives.queries';
import { produceVoiceCard } from './voice.queries';

const PREV_YEAR = '2026-01-01T04:30:00Z'; // Dec 31 23:30 New York
const E1 = '2026-01-01T05:30:00Z'; // Thu Jan 1 00:30 EST
const E2 = '2026-03-07T01:00:00Z'; // Fri Mar 6 20:00 EST
const E3 = '2026-03-14T00:00:00Z'; // Fri Mar 13 20:00 EDT
let testApp: TestApp;
let n = 0;

function ctxFor(userId: number): GgCardContext {
  return {
    db: testApp.db,
    userId,
    year: 2026,
    window: {
      start: new Date('2026-01-01T05:00:00Z'),
      end: new Date('2026-12-10T12:00:00Z'),
    },
    tz: 'America/New_York',
  };
}

async function insertUser(name: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role: 'member' })
      .returning({ id: schema.users.id }),
    name,
  );
  return u.id;
}

async function insertEvent(
  startIso: string,
  creatorId: number,
  cancelled = false,
): Promise<number> {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `E ${startIso}`,
        creatorId,
        gameId: testApp.seed.game.id,
        duration: [start, end],
        cancelledAt: cancelled ? new Date() : null,
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return e.id;
}

async function signup(
  eventId: number,
  userId: number,
  over: Partial<typeof schema.eventSignups.$inferInsert> = {},
): Promise<void> {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, ...over });
}

async function voice(
  eventId: number,
  userId: number,
  seconds: number,
  classification: string,
): Promise<void> {
  n += 1;
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId,
    userId,
    discordUserId: `d-${n}`,
    discordUsername: `v${n}`,
    firstJoinAt: new Date(),
    totalDurationSec: seconds,
    classification,
  });
}

/** Events + signups + voice for `me`; `other` creates the non-own events. */
async function seedEvents(me: number, other: number): Promise<void> {
  const prev = await insertEvent(PREV_YEAR, me);
  const e1 = await insertEvent(E1, me);
  const e2 = await insertEvent(E2, me);
  const e3 = await insertEvent(E3, other);
  const cancelled = await insertEvent('2026-03-20T00:00:00Z', me, true);
  const declined = await insertEvent('2026-05-01T00:00:00Z', other);
  const future = await insertEvent('2026-12-20T00:00:00Z', other);
  await signup(prev, me, { attendanceStatus: 'attended' });
  await signup(e1, me, { attendanceStatus: 'attended' });
  await signup(e2, me, { attendanceStatus: 'attended' });
  await signup(e3, me, { attendanceStatus: 'no_show' });
  await signup(cancelled, me, { attendanceStatus: 'attended' });
  await signup(declined, me, { status: 'declined' });
  await signup(future, me);
  await voice(prev, me, 7777, 'full');
  await voice(e1, me, 3600, 'full');
  await voice(e2, me, 1800, 'late');
  await voice(cancelled, me, 999, 'full');
}

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function media(
  guildId: number,
  me: number,
  at: string,
  removed = false,
): Promise<void> {
  n += 1;
  await testApp.db.insert(schema.hubMedia).values({
    guildId,
    source: 'upload',
    kind: 'upload',
    provenanceKey: `gg-${n}`,
    capturedAt: new Date(at),
    storageName: `gg-${n}.webp`,
    width: 1,
    height: 1,
    bytes: 1,
    uploadedBy: me,
    createdAt: new Date(at),
    removedAt: removed ? new Date(at) : null,
  });
}

/** Hub rows on both sides of the boundary: 1 join, 1 post, 1 kept picture count. */
async function seedHubs(me: number): Promise<void> {
  const a = await insertGuild('GGA');
  const b = await insertGuild('GGB');
  await testApp.db.insert(schema.hubCommunityMembers).values([
    {
      guildId: a,
      userId: me,
      role: 'member',
      joinedAt: new Date('2026-01-01T05:01:00Z'),
    },
    {
      guildId: b,
      userId: me,
      role: 'member',
      joinedAt: new Date('2026-01-01T04:59:00Z'),
    },
  ]);
  await testApp.db.insert(schema.hubPosts).values([
    {
      guildId: a,
      authorId: me,
      body: 'in',
      createdAt: new Date('2026-01-01T05:00:00Z'),
    },
    {
      guildId: a,
      authorId: me,
      body: 'out',
      createdAt: new Date('2026-01-01T04:59:59Z'),
    },
  ]);
  await media(a, me, '2026-06-01T12:00:00Z');
  await media(a, me, '2026-06-02T12:00:00Z', true);
  await media(a, me, PREV_YEAR);
}

/** 10 in-year game sessions, 3 starting 00:00–04:00 New York, + one last year. */
async function seedGameSessions(me: number): Promise<void> {
  const starts = [
    '2026-02-01T05:00:00Z',
    '2026-02-02T06:30:00Z',
    '2026-02-03T08:59:00Z',
    ...Array.from({ length: 7 }, (_, i) => `2026-04-${10 + i}T23:00:00Z`),
    PREV_YEAR,
  ];
  await testApp.db.insert(schema.gameActivitySessions).values(
    starts.map((s) => ({
      userId: me,
      gameId: testApp.seed.game.id,
      discordActivityName: 'Test Game',
      startedAt: new Date(s),
    })),
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Core GG metric producers (integration, ROK-2187)', () => {
  it('events: counts the tz year only, skips cancelled/future, uses the attendance resolver', async () => {
    const me = await insertUser('gg-me');
    await seedEvents(me, await insertUser('gg-other'));
    expect(await produceEventsCard(ctxFor(me))).toEqual({
      signedUp: 3,
      attended: 2,
      noShows: 1,
      excused: 1,
      created: 2,
      firstEventAt: '2026-01-01T05:30:00.000Z',
      lastEventAt: '2026-03-14T00:00:00.000Z',
    });
  });

  it('on-time: a voice session classified late breaks the streak', async () => {
    const me = await insertUser('gg-me');
    await seedEvents(me, await insertUser('gg-other'));
    expect(await produceOnTimeCard(ctxFor(me))).toEqual({
      attended: 2,
      onTime: 1,
      onTimeRatio: 0.5,
    });
  });

  it('rhythm: busiest month and favourite slot in the community tz (DST-aware)', async () => {
    const me = await insertUser('gg-me');
    await seedEvents(me, await insertUser('gg-other'));
    expect(await produceRhythmCard(ctxFor(me))).toEqual({
      busiestMonth: 3,
      busiestMonthEvents: 2,
      favouriteWeekday: 5,
      favouriteHour: 20,
    });
  });

  it('voice: sums the year’s counted events only', async () => {
    const me = await insertUser('gg-me');
    await seedEvents(me, await insertUser('gg-other'));
    expect(await produceVoiceCard(ctxFor(me))).toEqual({
      totalSeconds: 5400,
      sessions: 2,
    });
  });
});

describe('Core GG hubs + superlative producers (integration, ROK-2187)', () => {
  it('hubs: joins, posts and kept pictures inside the window (start inclusive)', async () => {
    const me = await insertUser('gg-me');
    await seedHubs(me);
    expect(await produceHubsCard(ctxFor(me))).toEqual({
      joined: 1,
      posts: 1,
      pictures: 1,
    });
  });

  it('superlative: night-owl from tz-local session hours; last year’s game is not new', async () => {
    const me = await insertUser('gg-me');
    await seedEvents(me, await insertUser('gg-other'));
    await seedGameSessions(me);
    expect(await produceSuperlativeCard(ctxFor(me))).toEqual({
      key: 'night-owl',
      value: 0.3,
    });
  });

  it('short GG: a user with nothing gets only the welcome-aboard superlative', async () => {
    const ctx = ctxFor(await insertUser('gg-empty'));
    expect(await produceEventsCard(ctx)).toBeNull();
    expect(await produceOnTimeCard(ctx)).toBeNull();
    expect(await produceRhythmCard(ctx)).toBeNull();
    expect(await produceVoiceCard(ctx)).toBeNull();
    expect(await produceHubsCard(ctx)).toBeNull();
    expect(await produceSuperlativeCard(ctx)).toEqual({
      key: 'welcome-aboard',
    });
  });
});
