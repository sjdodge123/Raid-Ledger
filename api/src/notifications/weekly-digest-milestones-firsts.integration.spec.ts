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

/** An active, guild-seen member who shows activity. */
async function seedUser(t: TestApp): Promise<number> {
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
async function firstNames(t: TestApp): Promise<string[]> {
  const { firstGames } = await fetchDigestMilestones(t.db);
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
});
