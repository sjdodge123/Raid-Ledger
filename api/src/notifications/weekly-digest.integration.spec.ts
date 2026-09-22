/**
 * Weekly Discord digest — recap aggregation against a real database
 * (ROK-1435 slice L1, AC3).
 *
 * The privacy block asserts BOTH values of `respectActivityOptOut`, because
 * operator Decision 4 (does the digest honour `show_activity = false`?) is
 * still open. Whichever way it is ruled, one of those assertions pins it.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { fetchWeeklyRecap } from './weekly-digest-recap.helpers';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { WeeklyDigestService } from './weekly-digest.service';
import { digestDedupKey, safeTimeZone } from './weekly-digest-schedule.helpers';

const HOUR = 3_600_000;

/** [start, end] for an event that ended `hoursEndAgo` hours ago. */
function endedAgo(hoursEndAgo: number, hoursLong = 3): [Date, Date] {
  const end = new Date(Date.now() - hoursEndAgo * HOUR);
  return [new Date(end.getTime() - hoursLong * HOUR), end];
}

/** [start, end] for an event that started an hour ago and is still running. */
function inProgress(): [Date, Date] {
  return [new Date(Date.now() - HOUR), new Date(Date.now() + 2 * HOUR)];
}

async function seedUser(testApp: TestApp, tag: string): Promise<number> {
  const [u] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `d:wd-${tag}`, username: `wd-${tag}`, role: 'member' })
    .returning();
  return u.id;
}

interface EventOpts {
  duration?: [Date, Date];
  cancelled?: boolean;
}

async function seedEvent(
  testApp: TestApp,
  creatorId: number,
  opts: EventOpts = {},
): Promise<number> {
  const [e] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Weekly digest recap event',
      creatorId,
      duration: opts.duration ?? endedAgo(24),
      cancelledAt: opts.cancelled ? new Date() : null,
    })
    .returning();
  return e.id;
}

async function seedSignup(
  testApp: TestApp,
  eventId: number,
  userId: number | null,
  attendanceStatus = 'attended',
): Promise<void> {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    discordUserId: userId === null ? `discord-only-${eventId}` : null,
    discordUsername: userId === null ? 'Anon' : null,
    attendanceStatus,
  });
}

async function seedShowActivity(
  testApp: TestApp,
  userId: number,
  value: boolean,
): Promise<void> {
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'show_activity', value });
}

describe('Weekly digest 7-day recap (ROK-1435 L1, integration)', () => {
  let testApp: TestApp;
  let creatorId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    creatorId = await seedUser(testApp, 'creator');
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('returns zeros when nothing was attended', async () => {
    await expect(fetchWeeklyRecap(testApp.db)).resolves.toEqual({
      eventsRun: 0,
      playersAttended: 0,
      attendances: 0,
    });
  });

  it('counts distinct events, distinct players and attendance pairs', async () => {
    const alice = await seedUser(testApp, 'alice');
    const bob = await seedUser(testApp, 'bob');
    const raid = await seedEvent(testApp, creatorId, {
      duration: endedAgo(24),
    });
    const dungeon = await seedEvent(testApp, creatorId, {
      duration: endedAgo(6 * 24),
    });
    await seedSignup(testApp, raid, alice);
    await seedSignup(testApp, raid, bob);
    await seedSignup(testApp, dungeon, bob);

    await expect(fetchWeeklyRecap(testApp.db)).resolves.toEqual({
      eventsRun: 2,
      playersAttended: 2,
      attendances: 3,
    });
  });

  it('excludes cancelled, stale, in-progress, non-attended and unlinked signups', async () => {
    const carol = await seedUser(testApp, 'carol');
    const counted = await seedEvent(testApp, creatorId);
    await seedSignup(testApp, counted, carol);

    const cancelled = await seedEvent(testApp, creatorId, { cancelled: true });
    const stale = await seedEvent(testApp, creatorId, {
      duration: endedAgo(8 * 24),
    });
    const running = await seedEvent(testApp, creatorId, {
      duration: inProgress(),
    });
    const noShow = await seedEvent(testApp, creatorId);
    const unlinked = await seedEvent(testApp, creatorId);
    await seedSignup(testApp, cancelled, carol);
    await seedSignup(testApp, stale, carol);
    await seedSignup(testApp, running, carol);
    await seedSignup(testApp, noShow, carol, 'no_show');
    await seedSignup(testApp, unlinked, null);

    await expect(fetchWeeklyRecap(testApp.db)).resolves.toEqual({
      eventsRun: 1,
      playersAttended: 1,
      attendances: 1,
    });
  });

  describe('show_activity = false (operator Decision 4, open)', () => {
    async function seedPrivacyFixture(): Promise<void> {
      const visible = await seedUser(testApp, 'visible');
      const hidden = await seedUser(testApp, 'hidden');
      const optedIn = await seedUser(testApp, 'opted-in');
      await seedShowActivity(testApp, hidden, false);
      await seedShowActivity(testApp, optedIn, true);
      const shared = await seedEvent(testApp, creatorId);
      const hiddenOnly = await seedEvent(testApp, creatorId);
      await seedSignup(testApp, shared, visible);
      await seedSignup(testApp, shared, hidden);
      await seedSignup(testApp, shared, optedIn);
      await seedSignup(testApp, hiddenOnly, hidden);
    }

    it('drops opted-out members (and events only they attended) by default', async () => {
      await seedPrivacyFixture();
      await expect(fetchWeeklyRecap(testApp.db)).resolves.toEqual({
        eventsRun: 1,
        playersAttended: 2,
        attendances: 2,
      });
    });

    it('drops opted-out members when respectActivityOptOut is true', async () => {
      await seedPrivacyFixture();
      const recap = await fetchWeeklyRecap(testApp.db, {
        respectActivityOptOut: true,
      });
      expect(recap).toEqual({
        eventsRun: 1,
        playersAttended: 2,
        attendances: 2,
      });
    });

    it('counts opted-out members when respectActivityOptOut is false', async () => {
      await seedPrivacyFixture();
      const recap = await fetchWeeklyRecap(testApp.db, {
        respectActivityOptOut: false,
      });
      expect(recap).toEqual({
        eventsRun: 2,
        playersAttended: 3,
        attendances: 4,
      });
    });
  });
});

/**
 * L4 dispatch against the real `notification_dedup` table. The Discord send is
 * the only fake; the claim, the Redis-flush fallback to the DB row and the
 * release-on-failure all run for real.
 */
describe('Weekly digest dispatch dedup (ROK-1435 L4, integration)', () => {
  let testApp: TestApp;
  let service: WeeklyDigestService;
  let redis: Redis;
  let sendEmbed: jest.SpyInstance;

  async function dedupRows(key: string): Promise<number> {
    const rows = await testApp.db.execute(
      sql`SELECT 1 FROM notification_dedup WHERE dedup_key = ${key}`,
    );
    return Array.from(rows).length;
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(WeeklyDigestService);
    redis = testApp.app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    const client = testApp.app.get(DiscordBotClientService);
    jest.spyOn(client, 'isConnected').mockReturnValue(true);
    sendEmbed = jest
      .spyOn(client, 'sendEmbed')
      .mockResolvedValue({ id: 'digest-msg' } as never);
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, 'digest-default-chan');
    const creator = await seedUser(testApp, 'dispatch-creator');
    const eventId = await seedEvent(testApp, creator, {
      duration: endedAgo(24),
    });
    await seedSignup(testApp, eventId, creator);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('posts once per week, and the DB row still blocks after a Redis flush', async () => {
    const now = new Date();
    const first = await service.postDigest(now);
    expect(first).toMatchObject({
      status: 'posted',
      channelId: 'digest-default-chan',
    });
    const key = (first as { dedupKey: string }).dedupKey;
    expect(await dedupRows(key)).toBe(1);

    await redis.del(key);
    const second = await service.postDigest(now);
    expect(second).toMatchObject({ status: 'duplicate', dedupKey: key });
    expect(sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('gives the week back when the send fails, so the next tick posts', async () => {
    const now = new Date();
    sendEmbed.mockRejectedValueOnce(new Error('Missing Access'));
    await expect(service.postDigest(now)).rejects.toThrow('Missing Access');
    const zone = await testApp.app.get(SettingsService).getDefaultTimezone();
    const key = digestDedupKey(now, safeTimeZone(zone));
    // Without the release this row would sit there for 8 days.
    expect(await dedupRows(key)).toBe(0);

    const retry = await service.postDigest(now);
    expect(retry).toMatchObject({ status: 'posted', dedupKey: key });
  });
});
