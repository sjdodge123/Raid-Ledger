/**
 * ROK-2063 — "First time the community played X" counts only play that 2+
 * members did together. A game is a first when its first-ever co-play
 * (≥ 15 min session overlap of 2 active members, or an attended event with
 * 2+ attendees — no lower time bound) falls inside this digest week. Solo
 * play never makes a first, and never stops a later co-play from being one.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { fetchDigestMilestones } from './weekly-digest-milestones.helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let seq = 0;

/** A guild-seen member who shows activity; `left` = deactivated since. */
async function seedUser(t: TestApp, left = false): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await t.db
      .insert(schema.users)
      .values({
        discordId: `d:mf-${seq}`,
        username: `mf-${seq}`,
        displayName: `Member ${seq}`,
        role: 'member',
        guildMemberSeenAt: new Date(),
        ...(left ? { deactivatedAt: new Date() } : {}),
      })
      .returning(),
    'user',
  );
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

/** A closed session from `startAgo` to `endAgo` ms before now. */
async function seedSession(
  t: TestApp,
  userId: number,
  gameId: number,
  startAgo: number,
  endAgo: number,
): Promise<void> {
  const now = Date.now();
  await t.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'game',
    startedAt: new Date(now - startAgo),
    endedAt: new Date(now - endAgo),
  });
}

/** A closed session between two absolute instants. */
async function seedSessionAt(
  t: TestApp,
  userId: number,
  gameId: number,
  from: Date,
  to: Date,
): Promise<void> {
  await t.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'game',
    startedAt: from,
    endedAt: to,
  });
}

/** Two members whose sessions on `gameId` overlap by one hour, `daysAgo` days ago. */
async function seedPair(
  t: TestApp,
  users: readonly [number, number],
  gameId: number,
  daysAgo: number,
): Promise<void> {
  const at = daysAgo * DAY;
  await seedSession(t, users[0], gameId, at, at - 2 * HOUR);
  await seedSession(t, users[1], gameId, at - HOUR, at - 3 * HOUR);
}

/** A 2-hour event for `gameId` that ended `daysAgo` days ago; all attended. */
async function seedEvent(
  t: TestApp,
  gameId: number,
  daysAgo: number,
  attendees: readonly number[],
): Promise<void> {
  const end = new Date(Date.now() - daysAgo * DAY);
  const [e] = nonEmpty(
    await t.db
      .insert(schema.events)
      .values({
        title: `mf event ${daysAgo}`,
        creatorId: nonEmpty([...attendees], 'attendees')[0],
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

/** Names of this week's first-time games. */
async function firstNames(t: TestApp, now?: Date): Promise<string[]> {
  const { firstGames } = await fetchDigestMilestones(t.db, now ? { now } : {});
  return firstGames.map((g) => g.name);
}

describe('Weekly digest firsts — co-play only (ROK-2063, integration)', () => {
  let testApp: TestApp;
  let ann: number;
  let bob: number;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  beforeEach(async () => {
    ann = await seedUser(testApp);
    bob = await seedUser(testApp);
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('a game first played solo this week, or overlapped < 15 min, is no first', async () => {
    const solo = await seedGame(testApp, 'Solo Game');
    const brief = await seedGame(testApp, 'Brief Overlap');
    await seedSession(testApp, ann, solo, 2 * DAY, 2 * DAY - 2 * HOUR);
    await seedSession(testApp, ann, brief, 2 * DAY, 2 * DAY - HOUR);
    await seedSession(
      testApp,
      bob,
      brief,
      2 * DAY - 50 * MIN,
      2 * DAY - 2 * HOUR,
    );

    expect(await firstNames(testApp)).toEqual([]);
  });

  it('two members overlapping ≥ 15 min for the first time this week is a first', async () => {
    const valheim = await seedGame(testApp, 'Valheim');
    await seedPair(testApp, [ann, bob], valheim, 2);

    expect(await firstNames(testApp)).toEqual(['Valheim']);
  });

  it('a game co-played in an earlier week and again this week is no first', async () => {
    const drg = await seedGame(testApp, 'Deep Rock Galactic');
    await seedPair(testApp, [ann, bob], drg, 20);
    await seedPair(testApp, [ann, bob], drg, 2);

    expect(await firstNames(testApp)).toEqual([]);
  });

  it('a game played solo earlier and co-played for the first time this week is a first', async () => {
    const lethal = await seedGame(testApp, 'Lethal Company');
    await seedSession(testApp, ann, lethal, 20 * DAY, 20 * DAY - 3 * HOUR);
    await seedEvent(testApp, lethal, 30, [bob]);
    await seedPair(testApp, [ann, bob], lethal, 2);

    expect(await firstNames(testApp)).toEqual(['Lethal Company']);
  });

  it('a 2-attendee event this week as the first co-play is a first; a 1-attendee one is not', async () => {
    const wow = await seedGame(testApp, 'World of Warcraft');
    const alone = await seedGame(testApp, 'Alone Raid');
    await seedEvent(testApp, wow, 1, [ann, bob]);
    await seedEvent(testApp, alone, 1, [ann]);

    expect(await firstNames(testApp)).toEqual(['World of Warcraft']);
  });

  it('a game co-played before the week by members who have since left is no first', async () => {
    const [gone1, gone2] = [
      await seedUser(testApp, true),
      await seedUser(testApp, true),
    ];
    const drg = await seedGame(testApp, 'Deep Rock Galactic');
    await seedPair(testApp, [gone1, gone2], drg, 20);
    await seedPair(testApp, [ann, bob], drg, 2);

    expect(await firstNames(testApp)).toEqual([]);
  });

  it('a co-play straddling the week start is a first in exactly one week', async () => {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * DAY);
    const at = (offset: number): Date => new Date(weekStart.getTime() + offset);
    const overnight = await seedGame(testApp, 'Overnight');
    const lateNight = await seedGame(testApp, 'Late Night');
    // Ann starts 24h before the week; Bob joins 10 min (Overnight) or 30 min
    // (Late Night) before it; both play on 1h into the week.
    for (const [game, joined] of [
      [overnight, 10 * MIN],
      [lateNight, 30 * MIN],
    ] as const) {
      await seedSessionAt(testApp, ann, game, at(-24 * HOUR), at(HOUR));
      await seedSessionAt(testApp, bob, game, at(-joined), at(HOUR));
    }

    expect(await firstNames(testApp, now)).toEqual(['Overnight']);
    expect(await firstNames(testApp, weekStart)).toEqual(['Late Night']);
  });
});

describe('Weekly digest firsts — boundary co-play credit (ROK-2063, integration)', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // Each game: two members playing together from `from` to `to`, relative to
  // the week boundary. A co-play is credited to the week holding the instant
  // its overlap reaches 15 minutes (`from + 15 min`).
  it('credits a boundary-straddling co-play to the week its 15th minute falls in', async () => {
    const now = new Date();
    const boundary = new Date(now.getTime() - 7 * DAY);
    const at = (offset: number): Date => new Date(boundary.getTime() + offset);
    const ann = await seedUser(testApp);
    const bob = await seedUser(testApp);
    const cases = [
      ['Never Reached', -10 * MIN, 4 * MIN], // 14 min in all: no week
      ['Codex Straddle', -10 * MIN, 10 * MIN], // reaches 15 min at +5
      ['Later Week', -10 * MIN, 20 * MIN], // reaches 15 min at +5
      ['Earlier Week', -30 * MIN, -5 * MIN], // reaches 15 min at −15
    ] as const;
    for (const [name, from, to] of cases) {
      const game = await seedGame(testApp, name);
      await seedSessionAt(testApp, ann, game, at(from), at(to));
      await seedSessionAt(testApp, bob, game, at(from), at(to));
    }

    expect(await firstNames(testApp, now)).toEqual([
      'Codex Straddle',
      'Later Week',
    ]);
    expect(await firstNames(testApp, boundary)).toEqual(['Earlier Week']);
  });
});
