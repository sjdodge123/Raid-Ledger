/**
 * Running Late delay re-arms reminder windows (ROK-2042).
 *
 * A host delay (`applyEventDelay`) shifts the event start. Reminder windows
 * that re-open for the NEW start (their threshold is smaller than the new
 * time-to-start) must fire again; windows already past for the new start stay
 * deduped so a delay never bursts extra DMs. Drives the reminder dispatch with
 * an explicit `now` so the "30 minutes later" pass is deterministic.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { EventReminderService } from '../notifications/event-reminder.service';
import { fetchCandidateEvents } from '../notifications/event-reminder.helpers';
import { NotificationService } from '../notifications/notification.service';
import { applyEventDelay } from './event-delay.helpers';

const MINUTE = 60_000;

/** Narrow an untyped jsonb payload to a plain record. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Seed a member signed up for an event starting `startOffsetMs` after `now`. */
async function seedEventWithSignup(
  testApp: TestApp,
  now: Date,
  startOffsetMs: number,
): Promise<{ eventId: number; userId: number }> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:late@test.local',
        username: 'late',
        role: 'member',
      })
      .returning(),
    'inserted user',
  );
  const start = new Date(now.getTime() + startOffsetMs);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Delayed Raid',
        creatorId: testApp.seed.adminUser.id,
        duration: [start, new Date(start.getTime() + 180 * MINUTE)],
        reminder15min: true,
        reminder1hour: true,
        reminder24hour: true,
      })
      .returning(),
    'inserted event',
  );
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: event.id, userId: user.id });
  return { eventId: event.id, userId: user.id };
}

/** Reminder notifications for one user and window, oldest first. */
async function remindersFor(
  testApp: TestApp,
  userId: number,
  window: string,
): Promise<Record<string, unknown>[]> {
  const rows = await testApp.db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, 'event_reminder'),
      ),
    )
    .orderBy(schema.notifications.id);
  return rows
    .map((r) => asRecord(r.payload))
    .filter((p) => p['reminderWindow'] === window);
}

/** Dedup window types recorded for the event + user. */
async function dedupTypes(
  testApp: TestApp,
  eventId: number,
  userId: number,
): Promise<string[]> {
  const rows = await testApp.db
    .select()
    .from(schema.eventRemindersSent)
    .where(
      and(
        eq(schema.eventRemindersSent.eventId, eventId),
        eq(schema.eventRemindersSent.userId, userId),
      ),
    );
  return rows.map((r) => r.reminderType).sort();
}

function describeDelayRearmsReminders() {
  let testApp: TestApp;
  let reminderService: EventReminderService;
  let notificationService: NotificationService;

  /** One reminder cron pass evaluated at `now`. */
  async function reminderPass(now: Date): Promise<void> {
    const candidates = await fetchCandidateEvents(testApp.db, now);
    await reminderService['dispatchReminderWindows'](candidates, now, 'UTC');
  }

  /** Host (admin) delays the event by `minutes`. */
  async function delay(eventId: number, minutes: number) {
    return applyEventDelay(
      testApp.db,
      notificationService,
      eventId,
      minutes,
      testApp.seed.adminUser.id,
      true,
    );
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    reminderService = testApp.app.get(EventReminderService);
    notificationService = testApp.app.get(NotificationService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('re-sends the 15min reminder for the new start after a +30 delay', async () => {
    const t0 = new Date();
    const { eventId, userId } = await seedEventWithSignup(
      testApp,
      t0,
      14 * MINUTE,
    );
    await reminderPass(t0);
    expect(await remindersFor(testApp, userId, '15min')).toHaveLength(1);

    const { newStart } = await delay(eventId, 30);
    await reminderPass(new Date(newStart.getTime() - 14 * MINUTE));

    const fifteen = await remindersFor(testApp, userId, '15min');
    expect(fifteen).toHaveLength(2);
    expect(fifteen[1]?.['startTime']).toBe(newStart.toISOString());
    // The 1hour window was already past for the new start: no second send.
    expect(await remindersFor(testApp, userId, '1hour')).toHaveLength(1);
  });

  it('keeps windows that are already past for the new start deduped', async () => {
    const t0 = new Date();
    const { eventId, userId } = await seedEventWithSignup(
      testApp,
      t0,
      14 * MINUTE,
    );
    await reminderPass(t0);
    expect(await dedupTypes(testApp, eventId, userId)).toEqual([
      '15min',
      '1hour',
      '24hour',
    ]);

    await delay(eventId, 15);
    // New start ~29 min out: only the 15min window re-arms.
    expect(await dedupTypes(testApp, eventId, userId)).toEqual([
      '1hour',
      '24hour',
    ]);
    await reminderPass(new Date());
    expect(await remindersFor(testApp, userId, '1hour')).toHaveLength(1);
    expect(await remindersFor(testApp, userId, '24hour')).toHaveLength(1);
    expect(await remindersFor(testApp, userId, '15min')).toHaveLength(1);
  });
}
describe('Event delay re-arms reminders (integration)', () =>
  describeDelayRearmsReminders());
