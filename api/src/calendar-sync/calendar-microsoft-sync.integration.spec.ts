/**
 * ROK-1597 §6 T19: the read + write + disconnect pipelines for a Microsoft
 * (Outlook) connection against Postgres — the real registry →
 * `MicrosoftCalendarAdapter` → the in-memory `FakeGraphCalendarApi` behind
 * the `microsoftHttp` spies. The member connects through the real OAuth
 * start + callback; every job is a REAL BullMQ job run through its
 * processor (the app's read + write workers are closed for the file).
 * Fixture times are TOMORROW (UTC) so they sit inside the read window.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  disconnectJobId,
  readSyncJobId,
} from './calendar-sync.constants';
import {
  PREFER_UTC,
  RL_COPY_PROP_ID,
} from './providers/microsoft/microsoft-graph.constants';
import {
  FAKE_DEFAULT_CALENDAR_ID,
  type FakeGraphCalendarApi,
} from './providers/microsoft/microsoft-graph-api.spec-helpers';
import {
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './read/calendar-read.enqueue.helpers';
import { tomorrowAt, DAY } from './read/calendar-read.integration.spec-helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import type {
  CalendarWriteJobData,
  ReconcileJobData,
} from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import {
  connectMicrosoft,
  enableMicrosoft,
  installGraph,
} from './calendar-microsoft.integration.spec-helpers';

const HOUR = 3_600_000;
/** An Outlook calendar the user already has, named like ours. */
const EXISTING_RL_CAL = 'AAMkADexisting-raid-ledger=';

let testApp: TestApp;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let writeQueue: Queue<CalendarWriteJobData>;
let readProcessor: CalendarReadProcessor;
let writeProcessor: CalendarWriteProcessor;
let api: FakeGraphCalendarApi;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get(getQueueToken(CALENDAR_READ_QUEUE));
  writeQueue = testApp.app.get(getQueueToken(CALENDAR_WRITE_QUEUE));
  readProcessor = testApp.app.get(CalendarReadProcessor);
  writeProcessor = testApp.app.get(CalendarWriteProcessor);
  await readProcessor.worker.close(true);
  await writeProcessor.worker.close(true);
});

beforeEach(async () => {
  await enableMicrosoft(testApp);
  api = installGraph().api;
  await readQueue.drain(true);
  await writeQueue.drain(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await readQueue.drain(true);
  await readQueue.clean(0, 1000, 'failed');
  await readQueue.clean(0, 1000, 'completed');
  await writeQueue.drain(true);
  await writeQueue.clean(0, 1000, 'completed');
  await writeQueue.clean(0, 1000, 'failed');
  await setCalendarSyncEnabled(settings, false);
  testApp.seed = await truncateAllTables(testApp.db);
});

const conns = schema.calendarConnections;

interface Member {
  userId: number;
  token: string;
  connectionId: number;
}

/** A member connected through the real OAuth routes (no queued jobs left). */
async function outlookMember(): Promise<Member> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-ms-sync-${seq}`,
    `cal-ms-sync-${seq}@example.test`,
  );
  expect((await connectMicrosoft(testApp, token)).connected).toBe('microsoft');
  const [row] = nonEmpty(
    await testApp.db.select().from(conns).where(eq(conns.userId, userId)),
    'connection',
  );
  await readQueue.drain(true);
  await writeQueue.drain(true);
  return { userId, token, connectionId: row.id };
}

async function connection(id: number) {
  const rows = await testApp.db.select().from(conns).where(eq(conns.id, id));
  const [row] = nonEmpty(rows, 'connection');
  return row;
}

/** Enqueue + run one read job through the processor. */
async function runRead(connectionId: number): Promise<unknown> {
  const res = await enqueueCalendarReadSync(
    { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
    connectionId,
  );
  expect(res.outcome).toBe('added');
  const jobId = readSyncJobId(connectionId);
  const job = await readQueue.getJob(jobId);
  if (!job) throw new Error(`no queued read job ${jobId}`);
  try {
    return await readProcessor.process(job);
  } finally {
    await readQueue.remove(jobId);
  }
}

function blocksOf(connectionId: number) {
  const t = schema.calendarBusyBlocks;
  return testApp.db
    .select({
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      allDay: t.allDay,
      firstDate: t.firstDate,
      lastDate: t.lastDate,
    })
    .from(t)
    .where(eq(t.connectionId, connectionId))
    .orderBy(t.startsAt);
}

/** `YYYY-MM-DD` of the UTC day `days` after today. */
function utcDate(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

/** Graph's all-day shape for `date` in a UTC+1 mailbox (23:00Z the day before). */
function berlinAllDay(date: string) {
  const start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - HOUR);
  const end = new Date(start.getTime() + DAY);
  const dt = (d: Date) => ({
    dateTime: `${d.toISOString().slice(0, 19)}.0000000`,
    timeZone: 'UTC',
  });
  return {
    subject: 'Holiday',
    showAs: 'oof',
    isAllDay: true,
    isCancelled: false,
    responseStatus: { response: 'organizer' },
    originalStartTimeZone: 'W. Europe Standard Time',
    start: dt(start),
    end: dt(end),
  };
}

describe('Microsoft read sync', () => {
  it('writes busy blocks from calendarView: a timed busy event and a non-UTC all-day day; Free is dropped', async () => {
    const m = await outlookMember();
    const day = utcDate(2);
    api.seedEvent(FAKE_DEFAULT_CALENDAR_ID, {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    api.seedEvent(FAKE_DEFAULT_CALENDAR_ID, {
      start: tomorrowAt(22),
      end: tomorrowAt(23),
      busy: false,
    });
    api.seedRaw(FAKE_DEFAULT_CALENDAR_ID, berlinAllDay(day));

    // mutation: make MicrosoftCalendarAdapter.fetchBusy throw → 'failed'/throw
    expect(await runRead(m.connectionId)).toBe('synced');

    const blocks = await blocksOf(m.connectionId);
    // mutation: treat showAs 'free' as busy in microsoft-normalize.helpers.ts
    // (3 rows); or drop the all-day IANA correction in
    // microsoft-all-day.helpers.ts (first/last date shift to the day before)
    expect(blocks).toEqual([
      {
        startsAt: tomorrowAt(19),
        endsAt: tomorrowAt(21),
        allDay: false,
        firstDate: null,
        lastDate: null,
      },
      expect.objectContaining({
        allDay: true,
        firstDate: day,
        lastDate: day,
      }),
    ]);
    const views = api.requests.filter((r) => r.url.includes('/calendarView'));
    expect(views.length).toBeGreaterThan(0);
    // mutation: drop PREFER_UTC from MICROSOFT_READ_PREFER
    expect(views.every((r) => r.prefer.includes(PREFER_UTC))).toBe(true);
    const row = await connection(m.connectionId);
    // mutation: skip the success stamp in the read processor
    expect(row.lastSyncedAt).not.toBeNull();
    expect(row.status).toBe('active');
  });
});

interface Writer extends Member {
  eventId: number;
}

async function outlookWriter(): Promise<Writer> {
  const m = await outlookMember();
  await testApp.db
    .update(conns)
    .set({ writeEnabled: true, writeTarget: 'dedicated' })
    .where(eq(conns.id, m.connectionId));
  const admin = testApp.seed.adminUser;
  const adminToken = await signTestAccessToken(testApp, {
    sub: admin.id,
    username: admin.username,
    role: 'admin',
  });
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Raid Night',
  });
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: m.userId,
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
  return { ...m, eventId };
}

async function runWrite(data: CalendarWriteJobData): Promise<unknown> {
  seq += 1;
  const jobId = `ms-i-${seq}`;
  const job: Job<CalendarWriteJobData> = await writeQueue.add(data.kind, data, {
    delay: HOUR,
    jobId,
  });
  try {
    return await writeProcessor.process(job);
  } finally {
    await writeQueue.remove(jobId);
  }
}

function reconcile(w: Writer): Promise<unknown> {
  const data: ReconcileJobData = {
    kind: 'reconcile',
    connectionId: w.connectionId,
    eventId: w.eventId,
    userId: w.userId,
  };
  return runWrite(data);
}

async function mustLink(w: Writer) {
  const t = schema.calendarEventLinks;
  const [link] = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.connectionId, w.connectionId), eq(t.eventId, w.eventId)));
  if (!link) throw new Error(`no calendar_event_links row for ${w.eventId}`);
  return link;
}

function mustCopy(eventId: string) {
  const found = api.findEvent(eventId);
  if (!found) throw new Error(`no Graph event ${eventId}`);
  return found;
}

function setSignupStatus(eventId: number, status: string) {
  return testApp.db
    .update(schema.eventSignups)
    .set({ status })
    .where(eq(schema.eventSignups.eventId, eventId));
}

const calendarPosts = () =>
  api.requests.filter(
    (r) =>
      r.method === 'POST' && r.url.split('?')[0]?.endsWith('/me/calendars'),
  );

describe('Microsoft write', () => {
  it('creates the "Raid Ledger" calendar when none exists and writes one busy copy into it', async () => {
    const w = await outlookWriter();

    // mutation: make MicrosoftCalendarAdapter.upsertEvent throw → not 'created'
    expect(await reconcile(w)).toEqual({ result: 'created' });

    const posts = calendarPosts();
    // mutation: RAID_LEDGER_CALENDAR_NAME → another name
    expect(posts.map((r) => r.body)).toEqual([
      expect.objectContaining({ name: 'Raid Ledger' }),
    ]);
    const calId = (await connection(w.connectionId)).dedicatedCalendarId ?? '';
    expect(api.calendars.get(calId)?.name).toBe('Raid Ledger');
    const link = await mustLink(w);
    const copy = mustCopy(link.providerEventId);
    // mutation: calendarEventsPath ignores the calendar id (copy lands in the default)
    expect(copy.calendarId).toBe(calId);
    expect(copy.event).toMatchObject({ subject: 'Raid Night', showAs: 'busy' });
  });

  it('adopts an existing "Raid Ledger" calendar by name, then updates and deletes the copy via its extended property', async () => {
    api.addCalendar(EXISTING_RL_CAL, 'Raid Ledger');
    const w = await outlookWriter();

    expect(await reconcile(w)).toEqual({ result: 'created' });
    // mutation: skip findRaidLedgerCalendar in ensureRaidLedgerCalendar (POSTs, 409s)
    expect(calendarPosts()).toEqual([]);
    expect((await connection(w.connectionId)).dedicatedCalendarId).toBe(
      EXISTING_RL_CAL,
    );
    const link = await mustLink(w);
    const created = mustCopy(link.providerEventId);
    expect(created.calendarId).toBe(EXISTING_RL_CAL);
    // mutation: drop singleValueExtendedProperties from buildMicrosoftEventBody
    expect(created.event.singleValueExtendedProperties).toEqual([
      {
        id: RL_COPY_PROP_ID,
        value: expect.stringMatching(new RegExp(`:${w.eventId}:${w.userId}$`)),
      },
    ]);

    await setSignupStatus(w.eventId, 'tentative');
    expect(await reconcile(w)).toEqual({ result: 'updated' });
    const relinked = await mustLink(w);
    // mutation: upsertEvent always POSTs (a new id, the old copy orphaned)
    expect(relinked.providerEventId).toBe(link.providerEventId);
    // mutation: copyIsBusy ignores tentative in buildMicrosoftPatchBody
    expect(mustCopy(link.providerEventId).event).toMatchObject({
      subject: '(Tentative) Raid Night',
      showAs: 'free',
    });

    await setSignupStatus(w.eventId, 'declined');
    expect(await reconcile(w)).toEqual({ result: 'deleted' });
    // mutation: deleteEvent resolves without the Graph DELETE
    expect(api.findEvent(link.providerEventId)).toBeNull();
  });
});

describe('Microsoft disconnect', () => {
  it('DELETE → 202; the disconnect job removes the dedicated calendar, its copy and the row', async () => {
    const w = await outlookWriter();
    await reconcile(w);
    const calId = (await connection(w.connectionId)).dedicatedCalendarId ?? '';
    const link = await mustLink(w);
    expect(api.calendars.has(calId)).toBe(true);

    const res = await testApp.request
      .delete(`/users/me/calendars/${w.connectionId}`)
      .set('Authorization', `Bearer ${w.token}`);
    // mutation: the DELETE route answers 200/204 (the D7 contract is 202)
    expect(res.status).toBe(202);
    const jobId = disconnectJobId(w.connectionId);
    const job = await writeQueue.getJob(jobId);
    if (!job) throw new Error(`no queued disconnect job ${jobId}`);
    try {
      await writeProcessor.process(job);
    } finally {
      await writeQueue.remove(jobId);
    }

    // mutation: deleteRaidLedgerCalendar resolves without the Graph DELETE
    expect(api.calendars.has(calId)).toBe(false);
    expect(api.findEvent(link.providerEventId)).toBeNull();
    const rows = await testApp.db
      .select()
      .from(conns)
      .where(eq(conns.id, w.connectionId));
    // mutation: the disconnect job never deletes the connection row
    expect(rows).toHaveLength(0);
  });
});
