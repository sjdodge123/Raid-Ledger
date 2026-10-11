/**
 * ROK-1596 A6: the nightly `CalendarWriteReconcileCron` (plan D11, AC7, epic
 * §5 test 7a as read by plan F14). Rows are written straight to the DB so no
 * emit fires — the cron is the only thing that can queue them. The worker is
 * paused for the file; queued keys are driven through `reconcileCalendarCopy`.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
  createPastEvent,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_WRITE_QUEUE,
  reconcileJobId,
} from './calendar-sync.constants';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { reconcileCalendarCopy } from './write/calendar-write-reconcile.helpers';
import { CalendarWriteReconcileCron } from './write/calendar-write-reconcile.cron';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const DAY = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let queue: Queue;
let processor: CalendarWriteProcessor;
let cron: CalendarWriteReconcileCron;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  processor = testApp.app.get(CalendarWriteProcessor);
  cron = testApp.app.get(CalendarWriteReconcileCron);
  await processor.worker.pause(true);
});

afterAll(() => {
  void processor.worker.resume();
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  await queue.drain(true);
});

afterEach(async () => {
  await queue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Member {
  userId: number;
  connectionId: number;
}

/** A member with a connected (fake) calendar, write on. */
async function member(): Promise<Member> {
  seq += 1;
  const { userId } = await createMemberAndLogin(
    testApp,
    `cal-cron-${seq}`,
    `cal-cron-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `cron-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ writeEnabled: true })
    .where(eq(schema.calendarConnections.id, id));
  return { userId, connectionId: id };
}

function eventInDays(days: number): Promise<number> {
  const start = new Date(Date.now() + days * DAY);
  return createFutureEvent(testApp, adminToken, {
    title: 'Raid Night',
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(),
  });
}

/** A sign-up row written directly — no SIGNUP_EVENTS emit. */
async function rawSignUp(eventId: number, userId: number): Promise<void> {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
}

function keyOf(m: Member, eventId: number) {
  return { connectionId: m.connectionId, eventId, userId: m.userId };
}

async function queuedIds(): Promise<string[]> {
  const jobs = await queue.getJobs(['delayed', 'waiting']);
  return jobs.map((j) => String(j.id)).sort();
}

async function linkRows() {
  return testApp.db
    .select({
      eventId: schema.calendarEventLinks.eventId,
      state: schema.calendarEventLinks.state,
      calendarId: schema.calendarEventLinks.calendarId,
    })
    .from(schema.calendarEventLinks);
}

it('kill switch off → the cron queues nothing', async () => {
  const m = await member();
  const eventId = await eventInDays(1);
  await rawSignUp(eventId, m.userId);
  await setCalendarSyncEnabled(settings, false);
  await cron.reconcile();
  expect(await queuedIds()).toEqual([]);
});

it('a sign-up written without an emit is queued nightly and gets its copy', async () => {
  const m = await member();
  const eventId = await eventInDays(1);
  await rawSignUp(eventId, m.userId);
  expect(await queuedIds()).toEqual([]);
  await cron.reconcile();
  expect(await queuedIds()).toEqual([
    reconcileJobId(m.connectionId, eventId, m.userId),
  ]);
  const job = await queue.getJob(
    reconcileJobId(m.connectionId, eventId, m.userId),
  );
  expect(job?.data).toEqual({ kind: 'reconcile', ...keyOf(m, eventId) });
  await queue.drain(true);
  expect(
    await reconcileCalendarCopy(processor.reconcileDeps(), keyOf(m, eventId)),
  ).toMatchObject({ result: 'created' });
  expect(fake.store.allCopies()).toHaveLength(1);
});

it('§5 7a (F14): an event row deleted by raw SQL, link left → copy deleted + link gone', async () => {
  const m = await member();
  const eventId = await eventInDays(1);
  await rawSignUp(eventId, m.userId);
  const deps = processor.reconcileDeps();
  expect(await reconcileCalendarCopy(deps, keyOf(m, eventId))).toMatchObject({
    result: 'created',
  });
  await testApp.db.execute(sql`DELETE FROM events WHERE id = ${eventId}`);
  expect(await linkRows()).toHaveLength(1);
  expect(await cron.run()).toEqual([keyOf(m, eventId)]);
  expect(await queuedIds()).toEqual([
    reconcileJobId(m.connectionId, eventId, m.userId),
  ]);
  await queue.drain(true);
  expect(await reconcileCalendarCopy(deps, keyOf(m, eventId))).toMatchObject({
    result: 'deleted',
  });
  expect(fake.store.allCopies()).toEqual([]);
  expect(await linkRows()).toEqual([]);
});

it('a link whose event was cancelled without an emit is queued', async () => {
  const m = await member();
  const eventId = await eventInDays(1);
  await rawSignUp(eventId, m.userId);
  const deps = processor.reconcileDeps();
  await reconcileCalendarCopy(deps, keyOf(m, eventId));
  await testApp.db
    .update(schema.events)
    .set({ cancelledAt: new Date() })
    .where(eq(schema.events.id, eventId));
  expect(await cron.run()).toEqual([keyOf(m, eventId)]);
});

it('ended events and events beyond the 28-day window are not queued', async () => {
  const m = await member();
  const past = await createPastEvent(testApp, m.userId);
  const far = await eventInDays(40);
  const inside = await eventInDays(27);
  for (const id of [past, far, inside]) await rawSignUp(id, m.userId);
  expect(await cron.run()).toEqual([keyOf(m, inside)]);
  expect(await queuedIds()).toEqual([
    reconcileJobId(m.connectionId, inside, m.userId),
  ]);
});

describe('suppressed links (Undo)', () => {
  async function suppressedLink(m: Member, eventId: number, id: string) {
    await testApp.db.insert(schema.calendarEventLinks).values({
      ...keyOf(m, eventId),
      calendarId: id,
      providerEventId: id,
      state: 'suppressed',
    });
  }

  it('an empty-id placeholder on a live sign-up is never queued', async () => {
    const m = await member();
    const eventId = await eventInDays(1);
    await rawSignUp(eventId, m.userId);
    await suppressedLink(m, eventId, '');
    expect(await cron.run()).toEqual([]);
    expect(await queuedIds()).toEqual([]);
  });

  it('a suppressed link whose event row is gone is left alone', async () => {
    const m = await member();
    const eventId = await eventInDays(1);
    await suppressedLink(m, eventId, 'rl-cal');
    await testApp.db.execute(sql`DELETE FROM events WHERE id = ${eventId}`);
    expect(await cron.run()).toEqual([]);
    expect(await linkRows()).toEqual([
      { eventId, state: 'suppressed', calendarId: 'rl-cal' },
    ]);
  });
});
