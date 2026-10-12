/**
 * ROK-1593 A9 — the calendar read pipeline end to end against the Fake
 * provider: `CalendarReadCron` → read queue → `CalendarReadProcessor` →
 * `calendar_busy_blocks` → busy hours / the scheduling heatmap.
 *
 * The read worker is paused for the file; each test runs the queued job
 * through `CalendarReadProcessor.process` so the outcome is deterministic.
 * The one exception (auth failure → `attemptsMade` 1) needs the real worker,
 * so it resumes it for that test only and waits for the job to fail.
 *
 * Fixture times are TOMORROW (UTC) so they sit inside the read window
 * (local midnight today → +N days) whatever the wall clock says.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { buildSchedulingAvailability } from '../../lineups/scheduling/scheduling-availability.helpers';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  disconnectJobId,
  readSyncJobId,
} from '../calendar-sync.constants';
import { ProviderAuthError } from '../providers/calendar-provider.errors';
import type {
  BusyBlock,
  ConnectResult,
  OAuthCredentials,
} from '../providers/calendar-provider.interface';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import { buildCopyId, deriveInstanceId } from '../providers/rl-copy-id.helpers';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { CalendarWriteProcessor } from '../write/calendar-write.processor';
import { fetchCalendarBusyHours } from './calendar-busy-query.helpers';
import { CalendarReadCron } from './calendar-read.cron';
import {
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './calendar-read.processor';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FOREIGN_INSTANCE = 'abcdefabcdef';

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let writeQueue: Queue;
let readProcessor: CalendarReadProcessor;
let writeProcessor: CalendarWriteProcessor;
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
  writeProcessor = testApp.app.get(CalendarWriteProcessor);
  cron = testApp.app.get(CalendarReadCron);
  await readProcessor.worker.pause(true);
  await writeProcessor.worker.pause(true);
});

afterAll(() => {
  void readProcessor.worker.resume();
  void writeProcessor.worker.resume();
});

/** Empty the shared Fake: copies, calendars, seeded busy, recorded calls. */
function resetFake(): void {
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  for (const cal of fake.store.listCalendars())
    fake.store.removeCalendar(cal.id);
  fake.seedCalendars([{ id: FAKE_PRIMARY_CALENDAR_ID, name: 'Primary' }]);
  fake.fetchBusyCalls.length = 0;
  fake.store.clearFailures();
  for (;;) {
    try {
      fake.store.takeReadFailure();
      return;
    } catch {
      // drop a queued read failure left by a failed test
    }
  }
}

beforeEach(async () => {
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  resetFake();
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

type ConnRow = typeof schema.calendarConnections.$inferInsert;

interface Member {
  userId: number;
  token: string;
  connectionId: number;
  credentials: OAuthCredentials;
}

/** A member with a Fake connection, read granted + enabled, due now. */
async function member(patch: Partial<ConnRow> = {}): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-read-${seq}`,
    `cal-read-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `read-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ readAccessGranted: true, readEnabled: true, ...patch })
    .where(eq(schema.calendarConnections.id, id));
  return { userId, token, connectionId: id, credentials: credsOf(result) };
}

/** The Fake ignores credentials on copy writes; any OAuth shape will do. */
function credsOf(result: ConnectResult): OAuthCredentials {
  const grant = result.credentials;
  return { ...grant, refreshToken: grant.refreshToken ?? 'fake-refresh' };
}

function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY + hour * HOUR + minute * 60 * 1000);
}

function weekStartOf(d: Date): Date {
  const s = new Date(d);
  s.setUTCHours(0, 0, 0, 0);
  s.setUTCDate(s.getUTCDate() - s.getUTCDay());
  return s;
}

function timed(start: Date, end: Date): BusyBlock {
  return { start, end, allDay: false };
}

async function instanceId(): Promise<string> {
  return deriveInstanceId(new URL(await settings.getClientUrl()).host);
}

/** A copy on `calendarId`, the way the write path stores one. */
async function upsertCopy(
  m: Member,
  calendarId: string,
  copy: { instance: string; eventId: number; start: Date; end: Date },
  title = 'Raid Night',
): Promise<void> {
  const copyId = buildCopyId({
    instanceId: copy.instance,
    eventId: copy.eventId,
    userId: m.userId,
  });
  await fake.upsertEvent(
    m.credentials,
    calendarId,
    {
      copyId,
      title,
      description: `${title} — notes`,
      url: 'https://example.test/events/1',
      start: copy.start,
      end: copy.end,
      tentative: false,
    },
    null,
  );
}

async function queuedReadIds(): Promise<string[]> {
  const jobs = await readQueue.getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs.map((j) => String(j.id)).sort();
}

/** Run the queued read job for `connectionId` through the processor. */
async function processQueued(connectionId: number): Promise<unknown> {
  const jobId = readSyncJobId(connectionId);
  const job = await readQueue.getJob(jobId);
  expect(job?.id).toBe(jobId);
  if (!job) throw new Error(`no queued read job ${jobId}`);
  const data: CalendarReadJobData = job.data;
  expect(data).toEqual({ kind: 'sync', connectionId });
  const outcome = await readProcessor.process(job);
  await readQueue.remove(jobId);
  return outcome;
}

/** Queue a read sync directly (as read consent / kill switch on do). */
async function enqueue(connectionId: number): Promise<void> {
  const res = await enqueueCalendarReadSync(
    { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
    connectionId,
  );
  expect(res.outcome).toBe('added');
}

function blocksOf(connectionId: number) {
  const t = schema.calendarBusyBlocks;
  return testApp.db
    .select({ startsAt: t.startsAt, endsAt: t.endsAt, allDay: t.allDay })
    .from(t)
    .where(eq(t.connectionId, connectionId))
    .orderBy(t.startsAt);
}

async function connection(id: number) {
  const c = schema.calendarConnections;
  const rows = await testApp.db.select().from(c).where(eq(c.id, id));
  const [row] = nonEmpty(rows, 'connection');
  return row;
}

// ── Cron ────────────────────────────────────────────────────────

describe('CalendarReadCron', () => {
  it('queues only read-enabled, syncable, due connections (error past its backoff included)', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - HOUR);
    const future = new Date(now.getTime() + HOUR);
    const due = await member();
    const errorDue = await member({ status: 'error', nextSyncAt: past });
    await member({ readEnabled: false });
    await member({ status: 'needs_reconnect', nextSyncAt: past });
    await member({ status: 'disconnecting', nextSyncAt: past });
    await member({ nextSyncAt: future });
    await member({ status: 'error', nextSyncAt: future });

    const picked = await cron.run(now);

    expect([...picked].sort((a, b) => a - b)).toEqual(
      [due.connectionId, errorDue.connectionId].sort((a, b) => a - b),
    );
    expect(await queuedReadIds()).toEqual(
      [
        readSyncJobId(due.connectionId),
        readSyncJobId(errorDue.connectionId),
      ].sort(),
    );
    const leased = await connection(due.connectionId);
    expect(leased.nextSyncAt?.getTime()).toBeGreaterThan(
      now.getTime() + 20 * 60 * 1000,
    );
  });

  it('a cron-queued job syncs through the processor and writes the block', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(21), tomorrowAt(22)),
    ]);

    expect(await cron.run()).toEqual([m.connectionId]);
    expect(await processQueued(m.connectionId)).toBe('synced');

    expect(await blocksOf(m.connectionId)).toEqual([
      { startsAt: tomorrowAt(21), endsAt: tomorrowAt(22), allDay: false },
    ]);
    const row = await connection(m.connectionId);
    expect(row.status).toBe('active');
    expect(row.lastSyncedAt).not.toBeNull();
  });

  it('prunes blocks that ended more than 24 h ago, keeps the rest', async () => {
    const m = await member();
    const now = new Date();
    const t = schema.calendarBusyBlocks;
    const owner = { connectionId: m.connectionId, userId: m.userId };
    await testApp.db.insert(t).values([
      {
        ...owner,
        startsAt: new Date(now.getTime() - 26 * HOUR),
        endsAt: new Date(now.getTime() - 25 * HOUR),
      },
      {
        ...owner,
        startsAt: new Date(now.getTime() - 24 * HOUR),
        endsAt: new Date(now.getTime() - 23 * HOUR),
      },
    ]);

    await cron.run(now);

    expect(await blocksOf(m.connectionId)).toEqual([
      {
        startsAt: new Date(now.getTime() - 24 * HOUR),
        endsAt: new Date(now.getTime() - 23 * HOUR),
        allDay: false,
      },
    ]);
  });
});

// ── Kill switch + failures ──────────────────────────────────────

describe('kill switch and provider failures', () => {
  it('kill switch off → the cron queues nothing and a queued job makes zero provider calls', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(21), tomorrowAt(22)),
    ]);
    await enqueue(m.connectionId);
    await setCalendarSyncEnabled(settings, false);

    expect(await cron.run()).toEqual([]);
    expect(await processQueued(m.connectionId)).toBe('skipped');

    expect(fake.fetchBusyCalls).toEqual([]);
    expect(await blocksOf(m.connectionId)).toEqual([]);
  });

  it('auth failure → needs_reconnect after exactly one attempt (real worker)', async () => {
    const m = await member();
    fake.failNextFetch(new ProviderAuthError('invalid_grant'));
    const jobId = readSyncJobId(m.connectionId);
    await enqueue(m.connectionId);
    void readProcessor.worker.resume();
    try {
      await waitFor(async () => {
        const job = await readQueue.getJob(jobId);
        expect(await job?.getState()).toBe('failed');
      }, 15_000);
    } finally {
      await readProcessor.worker.pause(true);
    }

    const job = await readQueue.getJob(jobId);
    expect(job?.attemptsMade).toBe(1);
    const row = await connection(m.connectionId);
    expect(row.status).toBe('needs_reconnect');
    expect(row.lastErrorCode).toBe('auth');
    expect(await blocksOf(m.connectionId)).toEqual([]);
  });
});

// ── R1 / R2 (§5 tests 2 + 7b) ───────────────────────────────────

describe('which calendars and blocks are read', () => {
  it('§5 test 2 (R1): the dedicated calendar is never fetched, even when listed in read_calendar_ids', async () => {
    fake.seedCalendars([
      { id: 'rl-dedicated', name: 'Raid Ledger' },
      { id: 'work', name: 'Work' },
    ]);
    fake.seedBusy('rl-dedicated', [timed(tomorrowAt(18), tomorrowAt(19))]);
    fake.seedBusy('work', [timed(tomorrowAt(21), tomorrowAt(22))]);
    const m = await member({
      writeTarget: 'dedicated',
      dedicatedCalendarId: 'rl-dedicated',
      readCalendarIds: [FAKE_PRIMARY_CALENDAR_ID, 'rl-dedicated', 'work'],
    });

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('synced');

    expect(fake.fetchBusyCalls.map((c) => c.calendarIds)).toEqual([
      [FAKE_PRIMARY_CALENDAR_ID, 'work'],
    ]);
    expect(await blocksOf(m.connectionId)).toEqual([
      { startsAt: tomorrowAt(21), endsAt: tomorrowAt(22), allDay: false },
    ]);
  });

  it('§5 test 7b (busy half): an orphan copy of ours is dropped, a foreign instance copy counts', async () => {
    const m = await member();
    // Orphan: our instance, no calendar_event_links row (link deleted).
    await upsertCopy(m, FAKE_PRIMARY_CALENDAR_ID, {
      instance: await instanceId(),
      eventId: 4242,
      start: tomorrowAt(18),
      end: tomorrowAt(19),
    });
    await upsertCopy(m, FAKE_PRIMARY_CALENDAR_ID, {
      instance: FOREIGN_INSTANCE,
      eventId: 4243,
      start: tomorrowAt(21),
      end: tomorrowAt(22),
    });

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('synced');

    expect(await blocksOf(m.connectionId)).toEqual([
      { startsAt: tomorrowAt(21), endsAt: tomorrowAt(22), allDay: false },
    ]);
    const weekStart = weekStartOf(tomorrowAt(0));
    const hours = await fetchCalendarBusyHours(
      testApp.db,
      m.userId,
      weekStart,
      new Date(weekStart.getTime() + 7 * DAY),
    );
    const day = tomorrowAt(0).getUTCDay();
    expect(hours).toEqual([
      { dayOfWeek: day, startHour: 21, endHour: 22, provider: 'google' },
    ]);
  });
});

// ── §5 test 1: our own copy is not double counted ───────────────

describe('§5 test 1 — a synced copy of our own event', () => {
  async function templatedSignUp(userId: number): Promise<number> {
    const day = tomorrowAt(0);
    await testApp.db
      .update(schema.users)
      .set({ gameTimeConfirmedAt: new Date() })
      .where(eq(schema.users.id, userId));
    const templateDay = (day.getUTCDay() + 6) % 7;
    await testApp.db.insert(schema.gameTimeTemplates).values(
      [19, 20, 21, 22].map((startHour) => ({
        userId,
        dayOfWeek: templateDay,
        startHour,
      })),
    );
    const [event] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Raid Night',
          creatorId: userId,
          gameId: testApp.seed.game.id,
          duration: [tomorrowAt(20), tomorrowAt(22)],
        })
        .returning(),
      'event',
    );
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: event.id, userId, status: 'signed_up' });
    return event.id;
  }

  function heatmap(userId: number) {
    return buildSchedulingAvailability(
      testApp.db,
      [userId],
      0,
      undefined,
      weekStartOf(tomorrowAt(0)),
      0,
    );
  }

  it('busyCount / availableCount match the no-calendar baseline', async () => {
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'cal-read-baseline',
      'cal-read-baseline@example.test',
    );
    const eventId = await templatedSignUp(userId);
    const baseline = await heatmap(userId);
    const day = tomorrowAt(0).getUTCDay();
    const cell = (h: number) =>
      baseline.cells.find((c) => c.dayOfWeek === day && c.hour === h);
    // Sanity: the sign-up alone already busies 20 + 21; 19 + 22 are free.
    expect([19, 20, 21, 22].map((h) => cell(h)?.busyCount)).toEqual([
      0, 1, 1, 0,
    ]);

    const result = fake.seedConnection({ id: 'baseline' });
    const { id } = await upsertCalendarConnection(testApp.db, {
      userId,
      provider: 'google',
      result,
    });
    await testApp.db
      .update(schema.calendarConnections)
      .set({ readAccessGranted: true, readEnabled: true })
      .where(eq(schema.calendarConnections.id, id));
    const m: Member = {
      userId,
      token,
      connectionId: id,
      credentials: credsOf(result),
    };
    await upsertCopy(m, FAKE_PRIMARY_CALENDAR_ID, {
      instance: await instanceId(),
      eventId,
      start: tomorrowAt(20),
      end: tomorrowAt(22),
    });

    expect(await cron.run()).toEqual([id]);
    expect(await processQueued(id)).toBe('synced');

    expect(fake.fetchBusyCalls).toHaveLength(1);
    expect(await blocksOf(id)).toEqual([]);
    const after = await heatmap(userId);
    expect(after.cells).toEqual(baseline.cells);
  });
});

// ── §6.4.4 disconnect + §6.4.2 stored shape ─────────────────────

describe('disconnect and stored shape', () => {
  it('§6.4.4: DELETE removes the blocks in the request, before the disconnect job runs', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(21), tomorrowAt(22)),
    ]);
    await enqueue(m.connectionId);
    await processQueued(m.connectionId);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);

    const res = await testApp.request
      .delete(`/users/me/calendars/${m.connectionId}`)
      .set('Authorization', `Bearer ${m.token}`);

    expect(res.status).toBeLessThan(300);
    const job = await writeQueue.getJob(disconnectJobId(m.connectionId));
    expect(await job?.getState()).toMatch(/^(waiting|delayed|prioritized)$/);
    expect((await connection(m.connectionId)).status).toBe('disconnecting');
    expect(await blocksOf(m.connectionId)).toEqual([]);
  });

  it('§6.4.2: a synced row holds only ids, instants, dates and the all-day flag', async () => {
    const m = await member();
    await upsertCopy(
      m,
      FAKE_PRIMARY_CALENDAR_ID,
      {
        instance: FOREIGN_INSTANCE,
        eventId: 77,
        start: tomorrowAt(21),
        end: tomorrowAt(22),
      },
      'Secret Dentist Appointment',
    );
    const date = tomorrowAt(0).toISOString().slice(0, 10);
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      {
        start: tomorrowAt(0),
        end: new Date(tomorrowAt(0).getTime() + DAY),
        allDay: true,
        allDayDates: { first: date, lastInclusive: date },
      },
    ]);

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('synced');

    const rows = await testApp.db.execute<Record<string, unknown>>(
      sql`SELECT * FROM calendar_busy_blocks`,
    );
    expect(rows).toHaveLength(2);
    const allowed = /^\d+$|^\d{4}-\d{2}-\d{2}$/;
    const offenders = rows.flatMap((row) =>
      Object.entries(row).filter(([, v]) => {
        if (v === null || v instanceof Date) return false;
        if (typeof v === 'number' || typeof v === 'boolean') return false;
        return !(typeof v === 'string' && allowed.test(v));
      }),
    );
    expect(offenders).toEqual([]);
    expect(Object.keys(nonEmpty([...rows], 'row')[0]).sort()).toEqual([
      'all_day',
      'connection_id',
      'ends_at',
      'first_date',
      'id',
      'last_date',
      'starts_at',
      'user_id',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Secret|Dentist|notes|example/);
  });
});
