/**
 * Running-late and event-delayed notices expire at the event end (TDB:196,
 * expiry half). A "someone is running late" or "event delayed" notice is
 * stale once the event is over, so it must carry `expiresAt` = event end and
 * be reaped by the expired-notification sweep after that instant — and not
 * a moment before.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { EventsService } from './events.service';
import { RunningLateService } from './running-late.service';

const MIN = 60_000;

type FakeTimersConfig = NonNullable<Parameters<typeof jest.useFakeTimers>[0]>;

/** Fake only `Date`: timers, ticks and I/O stay real for the DB driver. */
const PIN_DATE_ONLY: FakeTimersConfig = {
  doNotFake: [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
  ],
};

let testApp: TestApp;

async function createMember(username: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `discord-${username}`, username, role: 'member' })
      .returning(),
    'user',
  );
  return user.id;
}

async function createEvent(start: Date, end: Date) {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Expiry Raid',
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  return event;
}

async function signUp(eventId: number, userId: number) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    confirmationStatus: 'confirmed',
  });
}

async function noticesFor(
  userId: number,
  type: 'running_late' | 'event_delayed',
) {
  return testApp.db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, type),
      ),
    );
}

/** Runs the expired-notification sweep with the clock pinned at `at`. */
async function sweepAt(at: Date): Promise<void> {
  jest.useFakeTimers({ ...PIN_DATE_ONLY, now: at });
  try {
    await testApp.app.get(NotificationService).cleanupExpired();
  } finally {
    jest.useRealTimers();
  }
}

/** The notice survives the sweep until the end, and is gone just after it. */
async function expectReapedOnlyAfter(
  userId: number,
  type: 'running_late' | 'event_delayed',
  end: Date,
) {
  await sweepAt(new Date(end.getTime() - MIN));
  expect(await noticesFor(userId, type)).toHaveLength(1);
  await sweepAt(new Date(end.getTime() + MIN));
  expect(await noticesFor(userId, type)).toHaveLength(0);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.useRealTimers();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Event notice expiry (TDB:196)', () => {
  it('a running_late notice expires at the event end', async () => {
    const start = new Date(Date.now() - 10 * MIN);
    const end = new Date(start.getTime() + 120 * MIN);
    const event = await createEvent(start, end);
    const late = await createMember('expiry_late');
    const other = await createMember('expiry_other');
    await signUp(event.id, late);
    await signUp(event.id, other);

    await testApp.app.get(RunningLateService).notifyRunningLate(
      {
        id: event.id,
        title: event.title,
        duration: event.duration,
        creatorId: event.creatorId,
      },
      late,
      'Late Player',
    );

    const [notice] = nonEmpty(
      await noticesFor(other, 'running_late'),
      'notice',
    );
    expect(notice.expiresAt?.toISOString()).toBe(end.toISOString());
    await expectReapedOnlyAfter(other, 'running_late', end);
  });

  it('an event_delayed notice expires at the delayed end', async () => {
    const start = new Date(Date.now() + 24 * 60 * MIN);
    const end = new Date(start.getTime() + 180 * MIN);
    const event = await createEvent(start, end);
    const member = await createMember('expiry_member');
    await signUp(event.id, member);

    await testApp.app
      .get(EventsService)
      .delayEvent(event.id, 15, testApp.seed.adminUser.id);

    const newEnd = new Date(end.getTime() + 15 * MIN);
    const [notice] = nonEmpty(
      await noticesFor(member, 'event_delayed'),
      'notice',
    );
    expect(notice.expiresAt?.toISOString()).toBe(newEnd.toISOString());
    await expectReapedOnlyAfter(member, 'event_delayed', newEnd);
  });

  // REVIEW-B R5: the notice keeps its send-time expiresAt, but the sweep must
  // not reap it while the event is still running past that instant.
  async function lateNoticeFor(start: Date, end: Date) {
    const event = await createEvent(start, end);
    const late = await createMember('outlive_late');
    const other = await createMember('outlive_other');
    await signUp(event.id, late);
    await signUp(event.id, other);
    await testApp.app.get(RunningLateService).notifyRunningLate(
      {
        id: event.id,
        title: event.title,
        duration: event.duration,
        creatorId: event.creatorId,
      },
      late,
      'Late Player',
    );
    return { eventId: event.id, other };
  }

  it('a running_late notice outlives its expiresAt while extended_until runs on', async () => {
    const start = new Date(Date.now() - 10 * MIN);
    const end = new Date(start.getTime() + 120 * MIN);
    const { eventId, other } = await lateNoticeFor(start, end);
    const extendedUntil = new Date(end.getTime() + 60 * MIN);
    await testApp.db
      .update(schema.events)
      .set({ extendedUntil })
      .where(eq(schema.events.id, eventId));

    await expectReapedOnlyAfter(other, 'running_late', extendedUntil);
  });

  it('a running_late notice outlives its expiresAt after the event is pushed back', async () => {
    const start = new Date(Date.now() - 10 * MIN);
    const end = new Date(start.getTime() + 120 * MIN);
    const { eventId, other } = await lateNoticeFor(start, end);
    const newEnd = new Date(end.getTime() + 30 * MIN);
    await testApp.db
      .update(schema.events)
      .set({ duration: [start, newEnd] as [Date, Date] })
      .where(eq(schema.events.id, eventId));

    await expectReapedOnlyAfter(other, 'running_late', newEnd);
  });
});
