/**
 * ROK-1593 review fixes (lane FA) — the read sync's guards against the
 * shared connection row, proven against a real Postgres + the Fake:
 *
 * 1. A final transient read failure leaves `status='active'` (the ROK-1596
 *    write fan-out still selects the row), backs `next_sync_at` off and the
 *    cron re-picks it once that passes; the last good blocks stay.
 * 3. The 404/410 prune applies to the LOCKED row's `read_calendar_ids`, so a
 *    settings PUT that landed during the fetch survives.
 * 4. The kill switch is re-checked inside the transaction, and the busy
 *    query returns nothing while the switch is off.
 * 5. A connection the write side moved to `needs_reconnect` mid-fetch is not
 *    flipped back to `active` (nor its `auth` code cleared).
 *
 * The app's read/write workers are closed so no queued job races the test.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CALENDAR_READ_QUEUE, readSyncJobId } from '../calendar-sync.constants';
import { TransientError } from '../providers/calendar-provider.errors';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { findUserWriteConnectionIds } from '../write/calendar-write-fanout.helpers';
import { CalendarWriteProcessor } from '../write/calendar-write.processor';
import { fetchCalendarBusyHours } from './calendar-busy-query.helpers';
import { CalendarReadCron } from './calendar-read.cron';
import {
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './calendar-read.processor';
import { runCalendarReadSync } from './calendar-read-sync.helpers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const c = schema.calendarConnections;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let readProcessor: CalendarReadProcessor;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue<CalendarReadJobData>>(
    getQueueToken(CALENDAR_READ_QUEUE),
  );
  readProcessor = testApp.app.get(CalendarReadProcessor);
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
});

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(async () => {
  // The Fake provider is only resolved by the registry in demo mode.
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const cal of fake.store.listCalendars())
    fake.store.removeCalendar(cal.id);
  fake.seedCalendars([{ id: FAKE_PRIMARY_CALENDAR_ID, name: 'Primary' }]);
  fake.store.clearFailures();
  await readQueue.drain(true);
});

afterEach(async () => {
  await readQueue.drain(true);
  await readQueue.clean(0, 1000, 'failed');
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

const tomorrowAt = (hour: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY + hour * HOUR);
};

async function member(patch: Partial<typeof c.$inferInsert> = {}) {
  seq += 1;
  const { userId } = await createMemberAndLogin(
    testApp,
    `cal-guard-${seq}`,
    `cal-guard-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `guard-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(c)
    .set({ readAccessGranted: true, readEnabled: true, ...patch })
    .where(eq(c.id, id));
  return { userId, connectionId: id };
}

async function row(id: number) {
  const rows = await testApp.db.select().from(c).where(eq(c.id, id));
  return nonEmpty(rows, 'connection')[0];
}

function blocksOf(connectionId: number) {
  const t = schema.calendarBusyBlocks;
  return testApp.db
    .select({ startsAt: t.startsAt })
    .from(t)
    .where(eq(t.connectionId, connectionId));
}

async function sync(id: number, stillAllowed?: () => Promise<boolean>) {
  return runCalendarReadSync(
    {
      db: testApp.db,
      provider: fake,
      clientUrl: await settings.getClientUrl(),
      defaultTimezone: 'UTC',
      ...(stillAllowed ? { stillAllowed } : {}),
    },
    await row(id),
  );
}

function seedOneBlock(): void {
  fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
    { start: tomorrowAt(21), end: tomorrowAt(22), allDay: false },
  ]);
}

describe('fix 1 — a failed read never touches the shared status', () => {
  it('final transient failure: active, backed off, still a write target, re-picked when due', async () => {
    const m = await member({ writeEnabled: true });
    seedOneBlock();
    expect(await sync(m.connectionId)).toBe('synced');
    fake.failNextFetch(new TransientError('http_503'));
    await enqueueCalendarReadSync(
      { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
      m.connectionId,
    );
    const job = await readQueue.getJob(readSyncJobId(m.connectionId));
    if (!job) throw new Error('read job not queued');
    job.attemptsMade = (job.opts.attempts ?? 1) - 1; // the final attempt
    const before = Date.now();
    await expect(readProcessor.process(job)).rejects.toBeInstanceOf(
      TransientError,
    );

    const after = await row(m.connectionId);
    expect(after.status).toBe('active');
    expect(after.lastErrorCode).toBe('provider_error');
    expect(after.nextSyncAt?.getTime() ?? 0).toBeGreaterThanOrEqual(
      before + HOUR,
    );
    expect(await findUserWriteConnectionIds(testApp.db, m.userId)).toEqual([
      m.connectionId,
    ]);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    const cron = testApp.app.get(CalendarReadCron);
    expect(await cron.run(new Date(before + 2 * HOUR))).toEqual([
      m.connectionId,
    ]);
  });
});

describe('fix 3 — the prune reads the locked row', () => {
  it('a calendar added by a settings PUT during the fetch survives the 404 prune', async () => {
    const primary = FAKE_PRIMARY_CALENDAR_ID;
    const m = await member({ readCalendarIds: [primary, 'gone-cal'] });
    const stale = await row(m.connectionId);
    await testApp.db
      .update(c)
      .set({ readCalendarIds: [primary, 'gone-cal', 'new-cal'] })
      .where(eq(c.id, m.connectionId));
    await runCalendarReadSync(
      {
        db: testApp.db,
        provider: fake,
        clientUrl: await settings.getClientUrl(),
        defaultTimezone: 'UTC',
      },
      stale,
    );
    expect((await row(m.connectionId)).readCalendarIds).toEqual([
      primary,
      'new-cal',
    ]);
  });
});

describe('fix 4 — kill switch', () => {
  it('switched off after the pre-transaction check → skipped, nothing written', async () => {
    const m = await member();
    seedOneBlock();
    const answers = [true, false];
    const outcome = await sync(m.connectionId, () =>
      Promise.resolve(answers.shift() ?? false),
    );
    expect(outcome).toBe('skipped');
    expect(await blocksOf(m.connectionId)).toEqual([]);
  });

  it('the busy query yields nothing while the switch is off (blocks still stored)', async () => {
    const m = await member();
    seedOneBlock();
    expect(await sync(m.connectionId)).toBe('synced');
    const start = tomorrowAt(0);
    const end = new Date(start.getTime() + DAY);
    expect(
      await fetchCalendarBusyHours(testApp.db, m.userId, start, end),
    ).not.toEqual([]);
    await setCalendarSyncEnabled(settings, false);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    expect(
      await fetchCalendarBusyHours(testApp.db, m.userId, start, end),
    ).toEqual([]);
  });
});

describe('fix 5 — success never overwrites a needs_reconnect', () => {
  it('a write-side needs_reconnect set during the fetch is kept (status + auth code)', async () => {
    const m = await member();
    seedOneBlock();
    const outcome = await sync(m.connectionId, async () => {
      await testApp.db
        .update(c)
        .set({ status: 'needs_reconnect', lastErrorCode: 'auth' })
        .where(eq(c.id, m.connectionId));
      return true;
    });
    const after = await row(m.connectionId);
    expect([outcome, after.status, after.lastErrorCode]).toEqual([
      'skipped',
      'needs_reconnect',
      'auth',
    ]);
  });
});
