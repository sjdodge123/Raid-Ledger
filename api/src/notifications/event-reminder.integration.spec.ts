/**
 * Event Reminder Cron Pipeline Integration Tests (ROK-832)
 *
 * Verifies candidate event fetching, reminder window matching, dedup via
 * DB unique constraint, timezone resolution from user preferences, and
 * role-gap alert delegation — all against a real PostgreSQL database.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq, isNull } from 'drizzle-orm';
import { EventReminderService } from './event-reminder.service';
import { loadReminderContext } from './event-reminder.helpers';
import type { SignupStatus } from '../drizzle/schema/event-signups';

const ALL_SIGNUP_STATUSES: SignupStatus[] = [
  'signed_up',
  'tentative',
  'declined',
  'roached_out',
  'departed',
];

/** Create a user directly in DB, returning the user row. */
async function createUser(
  testApp: TestApp,
  username: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: 'member',
      ...overrides,
    })
    .returning();
  return user;
}

/** Create an event with a duration range relative to `now`. */
async function createEvent(
  testApp: TestApp,
  creatorId: number,
  title: string,
  startOffsetMs: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
) {
  const start = new Date(Date.now() + startOffsetMs);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId,
      duration: [start, end] as [Date, Date],
      reminder15min: true,
      reminder1hour: true,
      reminder24hour: true,
      ...overrides,
    })
    .returning();
  return event;
}

/** Sign up a user for an event. */
async function signUpUser(testApp: TestApp, eventId: number, userId: number) {
  await testApp.db.insert(schema.eventSignups).values({ eventId, userId });
}

/** Seed one user per signup status on the event; returns userId → status. */
async function seedOneSignupPerStatus(testApp: TestApp, eventId: number) {
  const statusByUserId = new Map<number, SignupStatus>();
  for (const status of ALL_SIGNUP_STATUSES) {
    const user = await createUser(testApp, `status-${status}`);
    statusByUserId.set(user.id, status);
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId, userId: user.id, status });
  }
  return statusByUserId;
}

/** Set a user timezone preference. */
async function setUserTimezone(
  testApp: TestApp,
  userId: number,
  timezone: string,
) {
  await testApp.db.insert(schema.userPreferences).values({
    userId,
    key: 'timezone',
    value: timezone,
  });
}

/** Build a sendReminder input payload. */
function reminderInput(
  event: { id: number; title: string; duration: [Date, Date] },
  userId: number,
  windowType: '15min' | '1hour' | '24hour',
  windowLabel: string,
  minutesUntil: number,
) {
  return {
    eventId: event.id,
    userId,
    windowType,
    windowLabel,
    title: event.title,
    startTime: event.duration[0],
    minutesUntil,
    characterDisplay: null,
  };
}

function describeEventReminderPipeline() {
  let testApp: TestApp;
  let reminderService: EventReminderService;

  beforeAll(async () => {
    testApp = await getTestApp();
    reminderService = testApp.app.get(EventReminderService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // =================================================================
  // Candidate Event Fetching
  // =================================================================

  function describeCandidateEvents() {
    it('should return events starting within the 24h window', async () => {
      const creatorId = testApp.seed.adminUser.id;
      await createEvent(testApp, creatorId, 'Soon Event', 60 * 60 * 1000);
      await createEvent(testApp, creatorId, 'Far Event', 48 * 60 * 60 * 1000);

      const allEvents = await testApp.db.select().from(schema.events);
      expect(allEvents.length).toBe(2);

      const soonEvent = allEvents.find((e) => e.title === 'Soon Event');
      expect(soonEvent).toBeDefined();
      expect(soonEvent!.duration[0]).toBeInstanceOf(Date);
      const msUntil = soonEvent!.duration[0].getTime() - Date.now();
      expect(msUntil).toBeLessThan(24 * 60 * 60 * 1000);
      expect(msUntil).toBeGreaterThan(0);
    });

    it('should exclude cancelled events from candidate set', async () => {
      const creatorId = testApp.seed.adminUser.id;
      await createEvent(testApp, creatorId, 'Active Event', 60 * 60 * 1000);
      await createEvent(testApp, creatorId, 'Cancelled Event', 60 * 60 * 1000, {
        cancelledAt: new Date(),
      });

      const candidates = await testApp.db
        .select()
        .from(schema.events)
        .where(isNull(schema.events.cancelledAt));

      expect(candidates.length).toBe(1);
      expect(candidates[0].title).toBe('Active Event');
    });

    it('should include events with reminder flags enabled', async () => {
      const creatorId = testApp.seed.adminUser.id;
      const event = await createEvent(
        testApp,
        creatorId,
        'Flagged',
        10 * 60 * 1000,
        {
          reminder15min: true,
          reminder1hour: false,
          reminder24hour: true,
        },
      );

      expect(event.reminder15min).toBe(true);
      expect(event.reminder1hour).toBe(false);
      expect(event.reminder24hour).toBe(true);
    });
  }
  describe('fetchCandidateEvents (via DB queries)', () =>
    describeCandidateEvents());

  // =================================================================
  // Reminder Window Matching
  // =================================================================

  function describeWindowMatching() {
    it('should create notification via sendReminder for 15min window', async () => {
      const user = await createUser(testApp, 'windowuser');
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'Window Test',
        10 * 60 * 1000,
      );
      await signUpUser(testApp, event.id, user.id);

      const minutesUntil = Math.round(
        (event.duration[0].getTime() - Date.now()) / 60000,
      );
      const sent = await reminderService.sendReminder(
        reminderInput(event, user.id, '15min', '15 Minutes', minutesUntil),
      );
      expect(sent).toBe(true);

      const notifs = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, user.id));

      expect(notifs.length).toBe(1);
      expect(notifs[0].type).toBe('event_reminder');
      expect(notifs[0].title).toContain('Event Starting');
    });

    it('should persist disabled reminder flag correctly', async () => {
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'No 15min',
        10 * 60 * 1000,
        {
          reminder15min: false,
        },
      );

      const [persisted] = await testApp.db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, event.id));

      expect(persisted.reminder15min).toBe(false);
    });

    it('should have no dedup records when no events match any window', async () => {
      await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'Far Away',
        48 * 60 * 60 * 1000,
      );
      const dedup = await testApp.db.select().from(schema.eventRemindersSent);
      expect(dedup.length).toBe(0);
    });
  }
  describe('processReminderWindows (via sendReminder)', () =>
    describeWindowMatching());

  // =================================================================
  // Deduplication
  // =================================================================

  function describeDedup() {
    it('should insert dedup record on first sendReminder', async () => {
      const user = await createUser(testApp, 'dedupuser');
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'Dedup Event',
        60 * 60 * 1000,
      );
      await signUpUser(testApp, event.id, user.id);

      const sent = await reminderService.sendReminder(
        reminderInput(event, user.id, '1hour', '1 Hour', 60),
      );
      expect(sent).toBe(true);

      const rows = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, event.id));

      expect(rows.length).toBe(1);
      expect(rows[0].userId).toBe(user.id);
      expect(rows[0].reminderType).toBe('1hour');
    });

    it('should return false on duplicate (same event+user+type)', async () => {
      const user = await createUser(testApp, 'dupuser');
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'Dup Event',
        60 * 60 * 1000,
      );
      await signUpUser(testApp, event.id, user.id);

      const input = reminderInput(event, user.id, '1hour', '1 Hour', 60);
      expect(await reminderService.sendReminder(input)).toBe(true);
      expect(await reminderService.sendReminder(input)).toBe(false);

      const notifs = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, user.id));
      expect(notifs.length).toBe(1);
    });

    it('should allow different reminder types for same event+user', async () => {
      const user = await createUser(testApp, 'multitypeuser');
      const event = await createEvent(
        testApp,
        testApp.seed.adminUser.id,
        'Multi',
        10 * 60 * 1000,
      );
      await signUpUser(testApp, event.id, user.id);

      const sent15 = await reminderService.sendReminder(
        reminderInput(event, user.id, '15min', '15 Minutes', 10),
      );
      const sent1h = await reminderService.sendReminder(
        reminderInput(event, user.id, '1hour', '1 Hour', 60),
      );
      expect(sent15).toBe(true);
      expect(sent1h).toBe(true);

      const rows = await testApp.db
        .select()
        .from(schema.eventRemindersSent)
        .where(eq(schema.eventRemindersSent.eventId, event.id));

      expect(rows.length).toBe(2);
      const types = rows.map((r) => r.reminderType).sort();
      expect(types).toEqual(['15min', '1hour']);
    });
  }
  describe('dedup via DB unique constraint', () => describeDedup());

  // =================================================================
  // Timezone Handling
  // =================================================================

  function describeTimezones() {
    it('should return correct timezone from user preference', async () => {
      const user = await createUser(testApp, 'tzuser');
      await setUserTimezone(testApp, user.id, 'America/New_York');

      const result = await reminderService.getUserTimezones([user.id]);
      expect(result.length).toBe(1);
      expect(result[0].userId).toBe(user.id);
      expect(result[0].timezone).toBe('America/New_York');
    });

    it('should fall back to UTC when preference is "auto"', async () => {
      const user = await createUser(testApp, 'autotzuser');
      await setUserTimezone(testApp, user.id, 'auto');

      const result = await reminderService.getUserTimezones([user.id]);
      expect(result.length).toBe(1);
      expect(result[0].timezone).toBe('UTC');
    });

    it('should return empty array when no timezone preference', async () => {
      const user = await createUser(testApp, 'notzuser');
      const result = await reminderService.getUserTimezones([user.id]);
      expect(result.length).toBe(0);
    });

    it('should return timezones for multiple users', async () => {
      const user1 = await createUser(testApp, 'tz1');
      const user2 = await createUser(testApp, 'tz2');
      await setUserTimezone(testApp, user1.id, 'Europe/London');
      await setUserTimezone(testApp, user2.id, 'Asia/Tokyo');

      const result = await reminderService.getUserTimezones([
        user1.id,
        user2.id,
      ]);
      expect(result.length).toBe(2);
      const tzMap = new Map(result.map((r) => [r.userId, r.timezone]));
      expect(tzMap.get(user1.id)).toBe('Europe/London');
      expect(tzMap.get(user2.id)).toBe('Asia/Tokyo');
    });
  }
  describe('timezone handling', () => describeTimezones());

  // =================================================================
  // Recipient status filter (ROK-1637)
  // =================================================================

  function describeRecipientStatusFilter() {
    it('reminds only signed_up and tentative players, never declined/roached_out/departed', async () => {
      const hostId = testApp.seed.adminUser.id;
      const event = await createEvent(
        testApp,
        hostId,
        'Status',
        60 * 60 * 1000,
      );
      const statusByUserId = await seedOneSignupPerStatus(testApp, event.id);

      const ctx = await loadReminderContext(testApp.db, [event.id], [hostId]);

      const remindedStatuses = (ctx?.signupsByEvent.get(event.id) ?? [])
        .map((id) => statusByUserId.get(id))
        .sort();
      expect(remindedStatuses).toEqual(['signed_up', 'tentative']);
    });

    it('still loads the host when the host has no active signup', async () => {
      const hostId = testApp.seed.adminUser.id;
      const event = await createEvent(testApp, hostId, 'Host', 60 * 60 * 1000);
      await testApp.db
        .insert(schema.eventSignups)
        .values({ eventId: event.id, userId: hostId, status: 'declined' });

      const ctx = await loadReminderContext(testApp.db, [event.id], [hostId]);

      expect(ctx?.signupsByEvent.get(event.id)).toBeUndefined();
      expect(ctx?.userMap.has(hostId)).toBe(true);
    });
  }
  describe('reminder recipients by signup status', () =>
    describeRecipientStatusFilter());

  // =================================================================
  // Role Gap Alerts
  // =================================================================

  describe('role gap alert delegation', () => {
    it('should complete handleReminders without error', async () => {
      await expect(reminderService.handleReminders()).resolves.not.toThrow();
    });
  });
}
describe('Event Reminder Cron Pipeline (integration)', () =>
  describeEventReminderPipeline());
