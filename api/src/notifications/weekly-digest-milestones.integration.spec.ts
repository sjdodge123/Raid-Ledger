/**
 * Weekly digest "Firsts & milestones" reads against a real database
 * (ROK-1771 L2, AC6 + AC10). Each of B1–B4 is seeded with a qualifying row and
 * the rows that must NOT appear: an opted-out member (`show_activity = false`)
 * and an OAuth guest never seen in the guild (`guild_member_seen_at` NULL).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import {
  emptyDigestMilestones,
  fetchDigestMilestones,
} from './weekly-digest-milestones.helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Inactive = 'deactivated' | 'banned' | 'kicked';

interface UserOpts {
  createdDaysAgo?: number;
  seenInGuild?: boolean;
  optedOut?: boolean;
  inactive?: Inactive;
}

const INACTIVE: readonly Inactive[] = ['deactivated', 'banned', 'kicked'];

/** The users-row stamp for one way of no longer being an active member. */
function inactiveStamp(kind: Inactive | undefined) {
  const at = new Date();
  if (kind === 'deactivated') return { deactivatedAt: at };
  if (kind === 'banned') return { bannedAt: at };
  return kind === 'kicked' ? { kickedAt: at } : {};
}

let seq = 0;

async function seedUser(
  testApp: TestApp,
  name: string,
  opts: UserOpts = {},
): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `d:ms-${seq}`,
        username: `ms-${seq}`,
        displayName: name,
        role: 'member',
        createdAt: new Date(Date.now() - (opts.createdDaysAgo ?? 30) * DAY),
        guildMemberSeenAt: opts.seenInGuild === false ? null : new Date(),
        ...inactiveStamp(opts.inactive),
      })
      .returning(),
    'user',
  );
  if (opts.optedOut) {
    await testApp.db
      .insert(schema.userPreferences)
      .values({ userId: u.id, key: 'show_activity', value: false });
  }
  return u.id;
}

async function seedGame(testApp: TestApp, name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
      .returning(),
    'game',
  );
  return g.id;
}

/** One attended event that ended `daysAgo` days ago (3 h long). */
async function seedAttended(
  testApp: TestApp,
  userId: number,
  daysAgo: number,
  gameId: number | null = null,
): Promise<void> {
  const end = new Date(Date.now() - daysAgo * DAY);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `ms event ${daysAgo}`,
        creatorId: userId,
        gameId,
        duration: [new Date(end.getTime() - 3 * HOUR), end],
      })
      .returning(),
    'event',
  );
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: e.id, userId, attendanceStatus: 'attended' });
}

/** Nine attended events before the window and one in it: the 10th. */
async function seedTenthEvent(testApp: TestApp, userId: number): Promise<void> {
  for (let i = 0; i < 9; i += 1) await seedAttended(testApp, userId, 20 + i);
  await seedAttended(testApp, userId, 2);
}

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

async function seedRollup(
  testApp: TestApp,
  userId: number,
  gameId: number,
  hours: number,
  daysAgo: number,
): Promise<void> {
  await testApp.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'day',
    periodStart: dateDaysAgo(daysAgo),
    totalSeconds: Math.round(hours * 3600),
  });
}

/** Shared app + truncate hooks; read `ctx.testApp` inside each test. */
function useMilestonesApp(): { testApp: TestApp } {
  const ctx = {} as { testApp: TestApp };
  beforeAll(async () => {
    ctx.testApp = await getTestApp();
  });
  afterEach(async () => {
    ctx.testApp.seed = await truncateAllTables(ctx.testApp.db);
  });
  return ctx;
}

describe('Weekly digest milestones — members (ROK-1771 L2, integration)', () => {
  const ctx = useMilestonesApp();
  let testApp: TestApp;
  beforeEach(() => {
    ({ testApp } = ctx);
  });

  it('returns an empty section when nothing happened', async () => {
    await expect(fetchDigestMilestones(testApp.db)).resolves.toEqual(
      emptyDigestMilestones(),
    );
  });

  it('B1: lists only new, guild-seen, opted-in members', async () => {
    await seedUser(testApp, 'Mira', { createdDaysAgo: 2 });
    await seedUser(testApp, 'Veteran', { createdDaysAgo: 30 });
    await seedUser(testApp, 'Guest', { createdDaysAgo: 1, seenInGuild: false });
    await seedUser(testApp, 'Hidden', { createdDaysAgo: 1, optedOut: true });

    const { newMembers } = await fetchDigestMilestones(testApp.db);
    expect(newMembers).toEqual({ names: ['Mira'], total: 1 });
  });

  it('B3: the 10th attended event is reported once; 11th and opted-out are not', async () => {
    const kael = await seedUser(testApp, 'Kael');
    const past = await seedUser(testApp, 'Past');
    const hidden = await seedUser(testApp, 'Hidden', { optedOut: true });
    for (let i = 0; i < 9; i += 1) {
      await seedAttended(testApp, kael, 20 + i);
      await seedAttended(testApp, hidden, 20 + i);
    }
    for (let i = 0; i < 10; i += 1) await seedAttended(testApp, past, 20 + i);
    await seedAttended(testApp, kael, 2);
    await seedAttended(testApp, hidden, 2);
    await seedAttended(testApp, past, 2);

    const { eventMilestones } = await fetchDigestMilestones(testApp.db);
    expect(eventMilestones).toEqual([
      { userId: kael, name: 'Kael', threshold: 10 },
    ]);
  });
});

describe('Weekly digest milestones — who may be named (AC10, integration)', () => {
  const ctx = useMilestonesApp();
  let testApp: TestApp;
  beforeEach(() => {
    ({ testApp } = ctx);
  });

  it('B1 and B3 skip deactivated, banned and kicked members', async () => {
    const kael = await seedUser(testApp, 'Kael');
    await seedTenthEvent(testApp, kael);
    for (const kind of INACTIVE) {
      const id = await seedUser(testApp, `Gone ${kind}`, {
        createdDaysAgo: 1,
        inactive: kind,
      });
      await seedTenthEvent(testApp, id);
    }

    const m = await fetchDigestMilestones(testApp.db);
    expect(m.newMembers).toEqual({ names: [], total: 0 });
    expect(m.eventMilestones).toEqual([
      { userId: kael, name: 'Kael', threshold: 10 },
    ]);
  });

  it('B3 never names an OAuth guest never seen in the guild', async () => {
    const kael = await seedUser(testApp, 'Kael');
    const guest = await seedUser(testApp, 'Guest', { seenInGuild: false });
    await seedTenthEvent(testApp, kael);
    await seedTenthEvent(testApp, guest);

    const { eventMilestones } = await fetchDigestMilestones(testApp.db);
    expect(eventMilestones).toEqual([
      { userId: kael, name: 'Kael', threshold: 10 },
    ]);
  });
});

describe('Weekly digest milestones — games (ROK-1771 L2, integration)', () => {
  const ctx = useMilestonesApp();
  let testApp: TestApp;
  beforeEach(() => {
    ({ testApp } = ctx);
  });

  it('B2: a game first played this week is listed; older or opted-out-only games are not', async () => {
    const ann = await seedUser(testApp, 'Ann');
    const hidden = await seedUser(testApp, 'Hidden', { optedOut: true });
    const valheim = await seedGame(testApp, 'Valheim');
    const lethal = await seedGame(testApp, 'Lethal Company');
    const wow = await seedGame(testApp, 'World of Warcraft');
    const secret = await seedGame(testApp, 'Secret Game');
    await seedAttended(testApp, ann, 2, valheim);
    await seedRollup(testApp, ann, lethal, 3, 2);
    await seedAttended(testApp, ann, 30, wow);
    await seedAttended(testApp, ann, 1, wow);
    await seedRollup(testApp, hidden, secret, 4, 1);

    const { firstGames } = await fetchDigestMilestones(testApp.db);
    expect(firstGames).toEqual([
      { gameId: lethal, name: 'Lethal Company' },
      { gameId: valheim, name: 'Valheim' },
    ]);
  });

  it('B4: a game crossing 100 community hours is listed; opted-out hours do not count', async () => {
    const ann = await seedUser(testApp, 'Ann');
    const hidden = await seedUser(testApp, 'Hidden', { optedOut: true });
    const drg = await seedGame(testApp, 'Deep Rock Galactic');
    const padded = await seedGame(testApp, 'Padded');
    await seedRollup(testApp, ann, drg, 90, 20);
    await seedRollup(testApp, ann, drg, 20, 2);
    await seedRollup(testApp, ann, padded, 90, 20);
    await seedRollup(testApp, hidden, padded, 30, 2);

    const { hourMilestones } = await fetchDigestMilestones(testApp.db);
    expect(hourMilestones).toEqual([
      { gameId: drg, name: 'Deep Rock Galactic', threshold: 100 },
    ]);
  });
});

describe('Weekly digest milestones — first games privacy (AC10, integration)', () => {
  const ctx = useMilestonesApp();
  let testApp: TestApp;
  beforeEach(() => {
    ({ testApp } = ctx);
  });

  it('B2: activity only from opted-out or inactive members, by event or rollup, is no first', async () => {
    const ann = await seedUser(testApp, 'Ann');
    const hidden = await seedUser(testApp, 'Hidden', { optedOut: true });
    const valheim = await seedGame(testApp, 'Valheim');
    await seedAttended(testApp, ann, 2, valheim);
    await seedAttended(testApp, hidden, 1, await seedGame(testApp, 'Opt Ev'));
    for (const kind of INACTIVE) {
      const gone = await seedUser(testApp, `Gone ${kind}`, { inactive: kind });
      await seedAttended(
        testApp,
        gone,
        1,
        await seedGame(testApp, `Ev ${kind}`),
      );
      await seedRollup(
        testApp,
        gone,
        await seedGame(testApp, `Ro ${kind}`),
        3,
        1,
      );
    }

    const { firstGames } = await fetchDigestMilestones(testApp.db);
    expect(firstGames).toEqual([{ gameId: valheim, name: 'Valheim' }]);
  });

  it('B2 and B4: an OAuth guest never seen in the guild contributes nothing', async () => {
    const ann = await seedUser(testApp, 'Ann');
    const guest = await seedUser(testApp, 'Guest', { seenInGuild: false });
    const valheim = await seedGame(testApp, 'Valheim');
    const drg = await seedGame(testApp, 'Deep Rock Galactic');
    await seedAttended(testApp, ann, 2, valheim);
    // B2: a game only the guest played this week, by event and by rollup.
    await seedAttended(testApp, guest, 1, await seedGame(testApp, 'Guest Ev'));
    await seedRollup(testApp, guest, await seedGame(testApp, 'Guest Ro'), 3, 1);
    // B4: 90 member hours; the guest's 20 this week would cross 100.
    await seedRollup(testApp, ann, drg, 90, 20);
    await seedRollup(testApp, guest, drg, 20, 2);

    const m = await fetchDigestMilestones(testApp.db);
    expect(m.firstGames).toEqual([{ gameId: valheim, name: 'Valheim' }]);
    expect(m.hourMilestones).toEqual([]);
  });
});
