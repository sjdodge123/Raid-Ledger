/**
 * ROK-1593 — synced away days self-heal
 * (`calendar-away-heal.helpers.ts`), against the real DB + Fake provider:
 *
 * - kill switch off + a synced absence the admin purge missed → the read
 *   cron's next tick deletes it (manual absences kept);
 * - read turned off on the user's only connection (PATCH) → a derive is
 *   queued → running it removes the synced days;
 * - a synced absence attributed to a `needs_reconnect` connection → the read
 *   cron queues a derive for its user → running it removes the day;
 * - past-only synced rows on a read-off connection are never matched by the
 *   cron backstop, and a derive leaves them.
 *
 * As in `calendar-away-sync.integration.spec.ts`, the app's read and write
 * WORKERS are closed for the file; queued jobs run in-test through
 * `CalendarReadProcessor.process`. Fixtures sit TOMORROW (UTC), zone UTC.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  deriveJobId,
  readSyncJobId,
} from '../calendar-sync.constants';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { CalendarWriteProcessor } from '../write/calendar-write.processor';
import {
  enqueueCalendarDerive,
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './calendar-read.enqueue.helpers';
import { CalendarReadCron } from './calendar-read.cron';
import { CalendarReadProcessor } from './calendar-read.processor';
import {
  allDay,
  resetFake,
  tomorrowAt,
} from './calendar-read.integration.spec-helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let writeQueue: Queue;
let readProcessor: CalendarReadProcessor;
let cron: CalendarReadCron;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue<CalendarReadJobData>>(
    getQueueToken(CALENDAR_READ_QUEUE),
  );
  writeQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  readProcessor = testApp.app.get(CalendarReadProcessor);
  cron = testApp.app.get(CalendarReadCron);
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
});

beforeEach(async () => {
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  resetFake(fake);
  await readQueue.drain(true);
  await writeQueue.drain(true);
});

afterEach(async () => {
  await readQueue.drain(true);
  await readQueue.clean(0, 1000, 'failed');
  await readQueue.clean(0, 1000, 'completed');
  await writeQueue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Member {
  userId: number;
  token: string;
  connectionId: number;
}

/** A member in zone UTC with one Fake read connection. */
async function member(): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-heal-${seq}`,
    `cal-heal-${seq}@example.test`,
  );
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'timezone', value: 'UTC' });
  const result = fake.seedConnection({ id: `heal-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ readAccessGranted: true, readEnabled: true })
    .where(eq(schema.calendarConnections.id, id));
  return { userId, token, connectionId: id };
}

const TOMORROW = () => tomorrowAt(0).toISOString().slice(0, 10);

/** Seed an all-day event tomorrow and run one sync → one synced day. */
async function syncedDay(m: Member): Promise<void> {
  fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
  const deps = { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) };
  await enqueueCalendarReadSync(deps, m.connectionId);
  const job = await readQueue.getJob(readSyncJobId(m.connectionId));
  if (!job) throw new Error('no queued sync job');
  expect(await readProcessor.process(job)).toBe('synced');
  await readQueue.remove(readSyncJobId(m.connectionId));
  expect(await sourcesOf(m.userId)).toEqual(['calendar']);
}

/** Run the queued derive for `userId`; fails loudly when none was queued. */
async function processDerive(userId: number): Promise<void> {
  const job = await readQueue.getJob(deriveJobId(userId));
  expect(job?.data).toEqual({ kind: 'derive', userId });
  if (!job) throw new Error(`no queued derive for user ${userId}`);
  expect(await readProcessor.process(job)).toBe('derived');
  await readQueue.remove(deriveJobId(userId));
}

async function sourcesOf(userId: number): Promise<string[]> {
  const a = schema.gameTimeAbsences;
  const rows = await testApp.db
    .select({ source: a.source })
    .from(a)
    .where(eq(a.userId, userId))
    .orderBy(asc(a.source), asc(a.id));
  return rows.map((r) => r.source);
}

async function addManualAbsence(userId: number): Promise<void> {
  const day = tomorrowAt(48).toISOString().slice(0, 10);
  await testApp.db
    .insert(schema.gameTimeAbsences)
    .values({ userId, startDate: day, endDate: day, source: 'manual' });
}

describe('kill switch off — cron self-heal', () => {
  it('a synced absence left behind is deleted on the next tick; manual kept', async () => {
    const m = await member();
    await syncedDay(m);
    await addManualAbsence(m.userId);
    // Stored off WITHOUT the admin route's purge: the purge "failed".
    await setCalendarSyncEnabled(settings, false);
    expect(await sourcesOf(m.userId)).toEqual(['calendar', 'manual']);

    await expect(cron.run()).resolves.toEqual([]);

    expect(await sourcesOf(m.userId)).toEqual(['manual']);
  });
});

describe('a connection that stops counting re-derives', () => {
  it('PATCH read off on the only connection → derive queued → synced days gone', async () => {
    const m = await member();
    await syncedDay(m);
    await addManualAbsence(m.userId);

    const res = await testApp.request
      .patch(`/users/me/calendars/${m.connectionId}`)
      .set('Authorization', `Bearer ${m.token}`)
      .send({ read: { enabled: false } });
    expect(res.status).toBe(204);

    await processDerive(m.userId);
    expect(await sourcesOf(m.userId)).toEqual(['manual']);
  });

  it('synced day attributed to a needs_reconnect connection → cron queues a derive', async () => {
    const m = await member();
    await syncedDay(m);
    // As the write side's auth failure does (reconcile / write-off).
    await testApp.db
      .update(schema.calendarConnections)
      .set({ status: 'needs_reconnect', lastErrorCode: 'auth' })
      .where(eq(schema.calendarConnections.id, m.connectionId));
    expect(await readQueue.getJob(deriveJobId(m.userId))).toBeUndefined();

    await cron.run();

    await processDerive(m.userId);
    expect(await sourcesOf(m.userId)).toEqual([]);
  });

  it('past-only synced rows on a read-off connection never re-trigger a derive', async () => {
    const m = await member();
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await testApp.db.insert(schema.gameTimeAbsences).values({
      userId: m.userId,
      startDate: past,
      endDate: past,
      source: 'calendar',
      calendarConnectionId: m.connectionId,
    });
    // Read off WITHOUT the PATCH route (which queues a derive itself).
    await testApp.db
      .update(schema.calendarConnections)
      .set({ readEnabled: false })
      .where(eq(schema.calendarConnections.id, m.connectionId));

    await cron.run();

    expect(await readQueue.getJob(deriveJobId(m.userId))).toBeUndefined();
    // History is never touched: a derive run anyway leaves the past row.
    await enqueueCalendarDerive(readQueue, m.userId);
    await processDerive(m.userId);
    expect(await sourcesOf(m.userId)).toEqual(['calendar']);
  });

  it('a healthy connection is not re-derived by the cron backstop', async () => {
    const m = await member();
    await syncedDay(m);

    await cron.run();

    expect(await readQueue.getJob(deriveJobId(m.userId))).toBeUndefined();
    expect(await sourcesOf(m.userId)).toEqual(['calendar']);
  });
});
