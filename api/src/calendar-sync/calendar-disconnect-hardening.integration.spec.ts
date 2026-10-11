/**
 * ROK-1596 review M1: a `disconnect` must never leave a row `disconnecting`
 * (refresh token retained, hidden from the overview). Permanent errors and
 * the final attempt delete the row; an enqueue failure runs the job inline;
 * the sweep cron re-queues rows whose job was lost. Runs against the Fake.
 */
import { eq } from 'drizzle-orm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import {
  CALENDAR_WRITE_QUEUE,
  disconnectJobId,
} from './calendar-sync.constants';
import type { CalendarWriteJobData } from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { CalendarDisconnectSweepCron } from './write/calendar-disconnect-sweep.cron';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import {
  ProviderRequestError,
  TransientError,
} from './providers/calendar-provider.errors';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const conns = schema.calendarConnections;

let testApp: TestApp;
let processor: CalendarWriteProcessor;
let queue: Queue;
let fake: FakeCalendarProvider;
let user: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  processor = testApp.app.get(CalendarWriteProcessor);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  await processor.worker.pause(true);
});

afterAll(() => processor.worker.resume());

beforeEach(async () => {
  await queue.drain(true); // ids repeat across truncations
  fake.store.clearFailures(); // another spec may leave one queued
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  seq += 1;
  user = await createMemberAndLogin(
    testApp,
    `cal-dch-${seq}`,
    `cal-dch-${seq}@example.test`,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  fake.store.clearFailures();
  await queue.drain(true);
  await testApp.app.get(SettingsService).setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

async function fakeConnection(): Promise<{ id: number; refresh: string }> {
  const result = fake.seedConnection({ id: `dch-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId: user.userId,
    provider: 'google',
    result,
  });
  const creds = result.credentials;
  return { id, refresh: creds.refreshToken ?? '' };
}

const rowsOf = (id: number) =>
  testApp.db.select().from(conns).where(eq(conns.id, id));

function del(id: number) {
  return testApp.request
    .delete(`/users/me/calendars/${id}`)
    .set('Authorization', `Bearer ${user.token}`);
}

/** Run the queued job; `attemptsMade` simulates earlier BullMQ attempts. */
async function runJob(id: number, attemptsMade = 0): Promise<unknown> {
  const job = (await queue.getJob(
    disconnectJobId(id),
  )) as Job<CalendarWriteJobData>;
  expect(job?.id).toBe(disconnectJobId(id));
  job.attemptsMade = attemptsMade;
  try {
    return await processor.process(job);
  } finally {
    await queue.remove(disconnectJobId(id));
  }
}

describe('disconnect job — never wedges (review M1)', () => {
  it('a permanent provider error → cleanup skipped, row deleted, token revoked', async () => {
    const { id, refresh } = await fakeConnection();
    await testApp.db
      .update(conns)
      .set({ dedicatedCalendarId: 'fake-gone' })
      .where(eq(conns.id, id));
    fake.store.failNext(new ProviderRequestError('http_400'));
    expect((await del(id)).status).toBe(202);
    expect(await runJob(id)).toEqual({
      found: true,
      remote: 'skipped_error',
      revoke: 'revoked',
    });
    expect(await rowsOf(id)).toEqual([]);
    expect(fake.revoked).toContain(refresh);
  });

  it('a transient error on the FINAL attempt → row deleted, no rethrow', async () => {
    const { id } = await fakeConnection();
    await testApp.db
      .update(conns)
      .set({ dedicatedCalendarId: 'fake-gone' })
      .where(eq(conns.id, id));
    fake.store.failNext(new TransientError('http_503'));
    expect((await del(id)).status).toBe(202);
    const outcome = await runJob(id, 5); // 6th of 6 attempts
    expect(outcome).toMatchObject({ found: true, remote: 'skipped_error' });
    expect(await rowsOf(id)).toEqual([]);
  });

  it('a transient error with attempts left still rethrows and keeps the row', async () => {
    const { id } = await fakeConnection();
    await testApp.db
      .update(conns)
      .set({ dedicatedCalendarId: 'fake-gone' })
      .where(eq(conns.id, id));
    fake.store.failNext(new TransientError('http_503'));
    expect((await del(id)).status).toBe(202);
    await expect(runJob(id, 4)).rejects.toBeInstanceOf(TransientError);
    expect((await rowsOf(id))[0]?.status).toBe('disconnecting');
  });

  it('enqueue fails (Redis down) → 202, the cleanup ran inline, row gone', async () => {
    const { id, refresh } = await fakeConnection();
    jest.spyOn(queue, 'add').mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await del(id)).status).toBe(202);
    expect(await rowsOf(id)).toEqual([]);
    expect(fake.revoked).toContain(refresh);
  });
});

describe('CalendarDisconnectSweepCron (review M1)', () => {
  it('re-queues a row disconnecting for >15 min, not a fresh one or an active one', async () => {
    const stale = await fakeConnection();
    seq += 1;
    const fresh = await fakeConnection();
    seq += 1;
    const active = await fakeConnection();
    const now = new Date();
    const old = new Date(now.getTime() - 20 * 60_000);
    await testApp.db
      .update(conns)
      .set({ status: 'disconnecting', updatedAt: old })
      .where(eq(conns.id, stale.id));
    await testApp.db
      .update(conns)
      .set({ status: 'disconnecting', updatedAt: now })
      .where(eq(conns.id, fresh.id));
    await testApp.db
      .update(conns)
      .set({ updatedAt: old })
      .where(eq(conns.id, active.id));
    const swept = await testApp.app.get(CalendarDisconnectSweepCron).run(now);
    expect(swept).toEqual([stale.id]);
    const job = await queue.getJob(disconnectJobId(stale.id));
    expect(job?.data).toEqual({ kind: 'disconnect', connectionId: stale.id });
    expect(await queue.getJob(disconnectJobId(fresh.id))).toBeUndefined();
    expect(await runJob(stale.id)).toMatchObject({ found: true });
    expect(await rowsOf(stale.id)).toEqual([]);
    expect((await rowsOf(active.id))[0]?.status).toBe('active');
  });
});
