/**
 * ROK-1593 B5 — synced away days end to end against the Fake provider:
 * read sync (`CalendarReadProcessor` → `afterBlocks` → `runCalendarDerive`)
 * and the queued `derive` job, triggered by the real routes (Ignore,
 * disconnect, kill switch, template PUT, read-mode PUT, manual absences).
 *
 * As in `calendar-read-sync.integration.spec.ts` (§12) the app's read and
 * write WORKERS are closed for the file; every queued job is run in-test
 * through `CalendarReadProcessor.process` and then removed.
 *
 * The user's zone is pinned to UTC and fixtures sit TOMORROW (UTC) or later,
 * inside the read window (local midnight today → +N days).
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { and, asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
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
import {
  enqueueCalendarDerive,
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
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
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

// ── Fixtures ────────────────────────────────────────────────────

interface Conn {
  connectionId: number;
  credentials: OAuthCredentials;
}
interface Member extends Conn {
  userId: number;
  token: string;
}

/** The Fake ignores credentials on copy writes; any OAuth shape will do. */
function credsOf(result: ConnectResult): OAuthCredentials {
  const grant = result.credentials;
  return { ...grant, refreshToken: grant.refreshToken ?? 'fake-refresh' };
}

/** Another Fake connection for `userId`, read granted + enabled. */
async function connect(userId: number): Promise<Conn> {
  seq += 1;
  const result = fake.seedConnection({ id: `away-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ readAccessGranted: true, readEnabled: true })
    .where(eq(schema.calendarConnections.id, id));
  return { connectionId: id, credentials: credsOf(result) };
}

/** A member in zone UTC with one read connection. */
async function member(): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-away-${seq}`,
    `cal-away-${seq}@example.test`,
  );
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'timezone', value: 'UTC' });
  return { userId, token, ...(await connect(userId)) };
}

function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY + hour * HOUR + minute * 60 * 1000);
}

const dateOf = (d: Date): string => d.toISOString().slice(0, 10);
const TOMORROW = () => dateOf(tomorrowAt(0));
const DAY_AFTER = () => dateOf(tomorrowAt(24));

function timed(start: Date, end: Date): BusyBlock {
  return { start, end, allDay: false };
}

function allDay(first: string, lastInclusive: string): BusyBlock {
  const start = new Date(`${first}T00:00:00.000Z`);
  const last = new Date(`${lastInclusive}T00:00:00.000Z`);
  return {
    start,
    end: new Date(last.getTime() + DAY),
    allDay: true,
    allDayDates: { first, lastInclusive },
  };
}

/** Template hours on tomorrow's weekday (DB convention: 0 = Monday). */
async function templateTomorrow(userId: number, hours: number[]) {
  const dayOfWeek = (tomorrowAt(0).getUTCDay() + 6) % 7;
  await testApp.db
    .insert(schema.gameTimeTemplates)
    .values(hours.map((startHour) => ({ userId, dayOfWeek, startHour })));
}

/** One of OUR copies (instance = this deployment) or a foreign one. */
async function upsertCopy(
  m: Member,
  copy: { instance: string; eventId: number; start: Date; end: Date },
): Promise<void> {
  const copyId = buildCopyId({
    instanceId: copy.instance,
    eventId: copy.eventId,
    userId: m.userId,
  });
  await fake.upsertEvent(
    m.credentials,
    FAKE_PRIMARY_CALENDAR_ID,
    {
      copyId,
      title: 'Raid Night',
      description: 'Raid Night — notes',
      url: 'https://example.test/events/1',
      start: copy.start,
      end: copy.end,
      tentative: false,
    },
    null,
  );
}

async function ourInstance(): Promise<string> {
  return deriveInstanceId(new URL(await settings.getClientUrl()).host);
}

// ── Queue driving (workers are closed; jobs run in-test) ────────

async function takeJob(jobId: string): Promise<Job<CalendarReadJobData>> {
  const job = await readQueue.getJob(jobId);
  expect(job?.id).toBe(jobId);
  if (!job) throw new Error(`no queued read job ${jobId}`);
  return job;
}

/** Run the queued sync job for `connectionId` through the processor. */
async function processSync(connectionId: number): Promise<unknown> {
  const job = await takeJob(readSyncJobId(connectionId));
  expect(job.data).toEqual({ kind: 'sync', connectionId });
  const outcome = await readProcessor.process(job);
  await readQueue.remove(readSyncJobId(connectionId));
  return outcome;
}

/** Run the queued `derive` job for `userId` through the processor. */
async function processDerive(userId: number): Promise<unknown> {
  const job = await takeJob(deriveJobId(userId));
  expect(job.data).toEqual({ kind: 'derive', userId });
  const outcome = await readProcessor.process(job);
  await readQueue.remove(deriveJobId(userId));
  return outcome;
}

/** Queue + run one sync (as the cron / consent / Sync now do). */
async function sync(connectionId: number): Promise<void> {
  const res = await enqueueCalendarReadSync(
    { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
    connectionId,
  );
  expect(res.outcome).toBe('added');
  expect(await processSync(connectionId)).toBe('synced');
}

function absencesOf(userId: number) {
  const a = schema.gameTimeAbsences;
  return testApp.db
    .select({
      id: a.id,
      source: a.source,
      startDate: a.startDate,
      endDate: a.endDate,
      calendarConnectionId: a.calendarConnectionId,
    })
    .from(a)
    .where(eq(a.userId, userId))
    .orderBy(asc(a.startDate), asc(a.id));
}

async function calendarRangesOf(userId: number) {
  const rows = await absencesOf(userId);
  return rows
    .filter((r) => r.source === 'calendar')
    .map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      calendarConnectionId: r.calendarConnectionId,
    }));
}

async function calendarRowId(userId: number): Promise<number> {
  const a = schema.gameTimeAbsences;
  const rows = await testApp.db
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.userId, userId), eq(a.source, 'calendar')));
  return nonEmpty(rows, 'calendar absence')[0].id;
}

function api(token: string) {
  const auth = (r: ReturnType<typeof testApp.request.get>) =>
    r.set('Authorization', `Bearer ${token}`);
  return {
    ignore: (id: number) =>
      auth(testApp.request.post(`/users/me/game-time/absences/${id}/ignore`)),
    createAbsence: (startDate: string, endDate: string) =>
      auth(testApp.request.post('/users/me/game-time/absences')).send({
        startDate,
        endDate,
      }),
    disconnect: (connectionId: number) =>
      auth(testApp.request.delete(`/users/me/calendars/${connectionId}`)),
    putTemplate: (slots: { dayOfWeek: number; hour: number }[]) =>
      auth(testApp.request.put('/users/me/game-time')).send({ slots }),
    putReadMode: (mode: 'days' | 'hours' | 'both') =>
      auth(testApp.request.put('/users/me/calendars/settings')).send({ mode }),
    listAbsences: () =>
      auth(testApp.request.get('/users/me/game-time/absences')),
  };
}

async function putKillSwitch(enabled: boolean): Promise<void> {
  const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const res = await testApp.request
    .put('/admin/settings/calendar-sync')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled });
  expect(res.status).toBe(200);
}

// ── Rules A + B ─────────────────────────────────────────────────

describe('derivation through a sync', () => {
  it('Rule A: an all-day event becomes a synced absence attributed to the connection', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), DAY_AFTER())]);

    await sync(m.connectionId);

    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: DAY_AFTER(),
        calendarConnectionId: m.connectionId,
      },
    ]);
    const res = await api(m.token).listAbsences();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('"source":"calendar"');
    expect(JSON.stringify(res.body)).toContain('"provider":"google"');
  });

  it('Rule B: an evening fully booked over the template hours is an away day', async () => {
    const m = await member();
    await templateTomorrow(m.userId, [19, 20, 21]);
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(18, 30), tomorrowAt(20)),
      timed(tomorrowAt(20), tomorrowAt(22, 30)),
    ]);

    await sync(m.connectionId);

    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: m.connectionId,
      },
    ]);
  });

  it('§5 test 7b (away half, R2): our own copy over the evening makes no away day; a foreign one does', async () => {
    const m = await member();
    await templateTomorrow(m.userId, [19, 20, 21]);
    await upsertCopy(m, {
      instance: await ourInstance(),
      eventId: 4242,
      start: tomorrowAt(18),
      end: tomorrowAt(23),
    });

    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toEqual([]);

    // Control: the same span from another deployment does count.
    await upsertCopy(m, {
      instance: FOREIGN_INSTANCE,
      eventId: 4242,
      start: tomorrowAt(18),
      end: tomorrowAt(23),
    });
    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: m.connectionId,
      },
    ]);
  });

  it('R4: a block matching an active sign-up (±60 s) makes no away day', async () => {
    const m = await member();
    await templateTomorrow(m.userId, [20, 21, 22]);
    const [event] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Raid Night',
          creatorId: m.userId,
          gameId: testApp.seed.game.id,
          duration: [tomorrowAt(19), tomorrowAt(23)],
        })
        .returning(),
      'event',
    );
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: event.id, userId: m.userId, status: 'signed_up' });
    // Not one of our copies (no copy id): only R4 can drop it.
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(new Date(tomorrowAt(19).getTime() + 30_000), tomorrowAt(23)),
    ]);

    await sync(m.connectionId);

    expect(await calendarRangesOf(m.userId)).toEqual([]);
  });
});

// ── Ignore, manual absences, round trip ─────────────────────────

describe('Ignore and manual absences', () => {
  it('Ignore survives a resync: the ignored range is not re-created', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    const id = await calendarRowId(m.userId);

    expect((await api(m.token).ignore(id)).status).toBe(204);
    expect(await processDerive(m.userId)).toBe('derived');
    await sync(m.connectionId);

    expect(await calendarRangesOf(m.userId)).toEqual([]);
    const ig = schema.calendarIgnoredDays;
    const ignored = await testApp.db
      .select({ date: ig.date })
      .from(ig)
      .where(eq(ig.userId, m.userId));
    expect(ignored.map((r) => r.date)).toEqual([TOMORROW()]);
  });

  it('Q-D: a manual absence hides its days from the derive and survives sync + Ignore', async () => {
    const m = await member();
    const created = await api(m.token).createAbsence(TOMORROW(), TOMORROW());
    expect(created.status).toBeLessThan(300);
    expect(await processDerive(m.userId)).toBe('derived');
    const [manual] = nonEmpty(await absencesOf(m.userId), 'manual absence');
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), DAY_AFTER())]);

    await sync(m.connectionId);

    // Only the day the manual absence does not cover is synced.
    expect(await absencesOf(m.userId)).toEqual([
      manual,
      expect.objectContaining({
        source: 'calendar',
        startDate: DAY_AFTER(),
        endDate: DAY_AFTER(),
      }),
    ]);

    const id = await calendarRowId(m.userId);
    expect((await api(m.token).ignore(id)).status).toBe(204);
    expect(await processDerive(m.userId)).toBe('derived');
    await sync(m.connectionId);

    expect(await absencesOf(m.userId)).toEqual([manual]);
  });

  it('§5 test 1 (absence half): a write→read round trip leaves absences unchanged, ids included', async () => {
    const m = await member();
    await templateTomorrow(m.userId, [19, 20, 21]);
    const far = (d: number) => dateOf(tomorrowAt(24 * d));
    expect(
      (await api(m.token).createAbsence(far(5), far(6))).status,
    ).toBeLessThan(300);
    // Our copy fills the templated evening; a foreign all-day makes a day.
    await upsertCopy(m, {
      instance: await ourInstance(),
      eventId: 99,
      start: tomorrowAt(18),
      end: tomorrowAt(23),
    });
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(DAY_AFTER(), DAY_AFTER())]);

    await sync(m.connectionId);
    const first = await absencesOf(m.userId);
    expect(first.map((r) => [r.source, r.startDate])).toEqual([
      ['calendar', DAY_AFTER()],
      ['manual', far(5)],
    ]);

    await sync(m.connectionId);
    expect(await absencesOf(m.userId)).toEqual(first);
  });
});

// ── Connections: Q16, Q12, §6.4.4 ───────────────────────────────

describe('connection lifecycle', () => {
  it('§6.4.4: disconnect removes the synced days in the request', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toHaveLength(1);

    const res = await api(m.token).disconnect(m.connectionId);

    expect(res.status).toBe(202);
    // No job has run: the request itself deleted the rows.
    expect(await calendarRangesOf(m.userId)).toEqual([]);
    expect(await processDerive(m.userId)).toBe('derived');
    expect(await calendarRangesOf(m.userId)).toEqual([]);
  });

  it('Q16: disconnect A while B still covers the day → rebuilt and attributed to B', async () => {
    const m = await member();
    const b = await connect(m.userId);
    expect(b.connectionId).toBeGreaterThan(m.connectionId);
    // One shared Fake calendar: both connections read the same all-day.
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    await sync(b.connectionId);
    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: m.connectionId,
      },
    ]);

    expect((await api(m.token).disconnect(m.connectionId)).status).toBe(202);
    expect(await calendarRangesOf(m.userId)).toEqual([]);
    expect(await processDerive(m.userId)).toBe('derived');

    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: b.connectionId,
      },
    ]);
  });

  it('Q12: a broken connection hides its days; a re-sync restores them', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toHaveLength(1);

    // Real failure path: auth error → needs_reconnect → derive queued.
    fake.failNextFetch(new ProviderAuthError('invalid_grant'));
    await enqueueCalendarReadSync(
      { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
      m.connectionId,
    );
    const job = await takeJob(readSyncJobId(m.connectionId));
    await expect(readProcessor.process(job)).rejects.toThrow(/auth/);
    await readQueue.remove(readSyncJobId(m.connectionId));
    expect(await processDerive(m.userId)).toBe('derived');
    expect(await calendarRangesOf(m.userId)).toEqual([]);

    const c = schema.calendarConnections;
    const reconnect = { status: 'active' as const, lastErrorCode: null };
    await testApp.db.update(c).set(reconnect).where(eq(c.id, m.connectionId));
    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toHaveLength(1);

    // The `error` status counts as broken too.
    await testApp.db
      .update(c)
      .set({ status: 'error' })
      .where(eq(c.id, m.connectionId));
    await enqueueCalendarDerive(readQueue, m.userId);
    expect(await processDerive(m.userId)).toBe('derived');
    expect(await calendarRangesOf(m.userId)).toEqual([]);
  });
});

// ── Kill switch, template, read mode ────────────────────────────

describe('settings that re-derive', () => {
  it('kill switch off → calendar absences purged, manual kept; on → rebuilt', async () => {
    const m = await member();
    const far = dateOf(tomorrowAt(24 * 5));
    expect((await api(m.token).createAbsence(far, far)).status).toBeLessThan(
      300,
    );
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    const manual = (await absencesOf(m.userId)).filter(
      (r) => r.source === 'manual',
    );
    expect(manual).toHaveLength(1);
    expect(await calendarRangesOf(m.userId)).toHaveLength(1);

    await putKillSwitch(false);
    expect(await absencesOf(m.userId)).toEqual(manual);

    await putKillSwitch(true);
    expect(await processSync(m.connectionId)).toBe('synced');
    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: m.connectionId,
      },
    ]);
    expect(
      (await absencesOf(m.userId)).filter((r) => r.source === 'manual'),
    ).toEqual(manual);
  });

  it('saveTemplate (PUT template) re-derives: a day that becomes fully covered appears', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(19), tomorrowAt(22)),
    ]);
    await sync(m.connectionId);
    // No template → Rule B never fires.
    expect(await calendarRangesOf(m.userId)).toEqual([]);
    expect(await readQueue.getJob(deriveJobId(m.userId))).toBeUndefined();

    const dayOfWeek = tomorrowAt(0).getUTCDay(); // display: 0 = Sunday
    const res = await api(m.token).putTemplate(
      [19, 20, 21].map((hour) => ({ dayOfWeek, hour })),
    );
    expect(res.status).toBe(200);
    // The listener enqueues after `emit` returns (not awaited by the route).
    await waitFor(async () => {
      expect(await readQueue.getJob(deriveJobId(m.userId))).toBeDefined();
    });
    expect(await processDerive(m.userId)).toBe('derived');

    expect(await calendarRangesOf(m.userId)).toEqual([
      {
        startDate: TOMORROW(),
        endDate: TOMORROW(),
        calendarConnectionId: m.connectionId,
      },
    ]);
  });

  it('read mode PUT `hours` → the calendar rows are removed', async () => {
    const m = await member();
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [allDay(TOMORROW(), TOMORROW())]);
    await sync(m.connectionId);
    expect(await calendarRangesOf(m.userId)).toHaveLength(1);

    expect((await api(m.token).putReadMode('hours')).status).toBe(204);
    expect(await processDerive(m.userId)).toBe('derived');

    expect(await calendarRangesOf(m.userId)).toEqual([]);
  });
});
