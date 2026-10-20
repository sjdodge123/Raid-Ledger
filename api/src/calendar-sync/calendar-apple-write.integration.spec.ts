/**
 * ROK-1598 I9 + D6 + Q8 + §2.3: the calendar WRITE pipeline for an Apple
 * (CalDAV) connection against Postgres — a real write job through the
 * registry → `AppleCalendarAdapter` → the in-process `FakeCalDavServer`.
 *
 * iCloud is the fake behind a namespace spy on `caldavFetch`. The member
 * connects through `POST /users/me/calendars/apple` (session signed with
 * `signTestAccessToken`), then write is switched on with the dedicated
 * target. Each write job is a REAL BullMQ job (added with a long delay so
 * nothing else picks it up — the app's read + write workers are closed for
 * the file) run through `CalendarWriteProcessor.process`.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { createFutureEvent } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  disconnectJobId,
} from './calendar-sync.constants';
import * as appleHttp from './providers/apple/apple-caldav-http';
import {
  FAKE_CALDAV_CREDENTIALS,
  FAKE_HOME_SET_URL,
  FakeCalDavServer,
  type FakeSeenRequest,
} from './providers/apple/apple-caldav.spec-helpers';
import { copyResourceName } from './providers/apple/apple-write.helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './services/calendar-credentials.helpers';
import type {
  CalendarWriteJobData,
  ReconcileJobData,
} from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';

/** A home set on another DSID: every path under it 404s on the fake. */
const STALE_HOME_SET_URL = 'https://p07-caldav.icloud.com/7654321/calendars/';
const HOUR = 3_600_000;

let testApp: TestApp;
let settings: SettingsService;
let readQueue: Queue;
let writeQueue: Queue<CalendarWriteJobData>;
let processor: CalendarWriteProcessor;
let server: FakeCalDavServer;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_READ_QUEUE));
  writeQueue = testApp.app.get<Queue<CalendarWriteJobData>>(
    getQueueToken(CALENDAR_WRITE_QUEUE),
  );
  processor = testApp.app.get(CalendarWriteProcessor);
  await processor.worker.close(true);
  await testApp.app.get(CalendarReadProcessor).worker.close(true);
});

beforeEach(async () => {
  await setCalendarSyncEnabled(settings, true);
  server = new FakeCalDavServer();
  jest.spyOn(appleHttp, 'caldavFetch').mockImplementation(server.handle);
  await readQueue.drain(true);
  await writeQueue.drain(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await readQueue.drain(true);
  await writeQueue.drain(true);
  await writeQueue.clean(0, 1000, 'completed');
  await writeQueue.clean(0, 1000, 'failed');
  await setCalendarSyncEnabled(settings, false);
  testApp.seed = await truncateAllTables(testApp.db);
});

const conns = schema.calendarConnections;

interface AppleWriter {
  userId: number;
  token: string;
  connectionId: number;
  eventId: number;
}

/** A member signed up to a future event, iCloud connected, write on. */
async function appleWriter(status = 'signed_up'): Promise<AppleWriter> {
  seq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:cal-apple-write-${seq}`,
        username: `cal-apple-write-${seq}`,
        role: 'member',
      })
      .returning(),
    'member',
  );
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: 'member',
  });
  const res = await testApp.request
    .post('/users/me/calendars/apple')
    .set('Authorization', `Bearer ${token}`)
    .send({
      email: FAKE_CALDAV_CREDENTIALS.username,
      appPassword: FAKE_CALDAV_CREDENTIALS.appPassword,
    });
  expect(res.status).toBe(201);
  const connectionId = Number(res.body.id);
  await testApp.db
    .update(conns)
    .set({ writeEnabled: true, writeTarget: 'dedicated' })
    .where(eq(conns.id, connectionId));
  const eventId = await futureEventWithSignup(user.id, status);
  return { userId: user.id, token, connectionId, eventId };
}

async function futureEventWithSignup(userId: number, status: string) {
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
    userId,
    status,
    confirmationStatus: 'pending',
  });
  return eventId;
}

/** Run one REAL write job through the processor, then drop it. */
async function runJob(data: CalendarWriteJobData): Promise<unknown> {
  seq += 1;
  const jobId = `i9-${seq}`;
  const job: Job<CalendarWriteJobData> = await writeQueue.add(data.kind, data, {
    delay: HOUR,
    jobId,
  });
  try {
    return await processor.process(job);
  } finally {
    await writeQueue.remove(jobId);
  }
}

function reconcile(w: AppleWriter): Promise<unknown> {
  const data: ReconcileJobData = {
    kind: 'reconcile',
    connectionId: w.connectionId,
    eventId: w.eventId,
    userId: w.userId,
  };
  return runJob(data);
}

async function connection(id: number) {
  const rows = await testApp.db.select().from(conns).where(eq(conns.id, id));
  const [row] = nonEmpty(rows, 'connection');
  return row;
}

async function linkOf(w: AppleWriter) {
  const t = schema.calendarEventLinks;
  const [row] = await testApp.db
    .select()
    .from(t)
    .where(and(eq(t.connectionId, w.connectionId), eq(t.eventId, w.eventId)));
  return row ?? null;
}

async function mustLink(w: AppleWriter) {
  const link = await linkOf(w);
  if (!link) throw new Error(`no calendar_event_links row for ${w.eventId}`);
  return link;
}

const objectUrlOf = (link: { calendarId: string; providerEventId: string }) =>
  `${server.collectionUrl(link.calendarId)}${link.providerEventId}`;

function since(mark: number, method: FakeSeenRequest['method']) {
  return server.requests.slice(mark).filter((r) => r.method === method);
}

function setSignupStatus(eventId: number, status: string) {
  return testApp.db
    .update(schema.eventSignups)
    .set({ status })
    .where(eq(schema.eventSignups.eventId, eventId));
}

/** Store credentials whose home set moved (a partition move, §2.3). */
async function staleHomeSet(connectionId: number): Promise<void> {
  const stored = decryptCalendarCredentials(
    (await connection(connectionId)).credentialsEncrypted,
  );
  if (stored.kind !== 'caldav') throw new Error('not caldav credentials');
  await testApp.db
    .update(conns)
    .set({
      credentialsEncrypted: encryptCalendarCredentials({
        ...stored,
        homeSetUrl: STALE_HOME_SET_URL,
      }),
    })
    .where(eq(conns.id, connectionId));
}

async function storedHomeSet(connectionId: number) {
  const creds = decryptCalendarCredentials(
    (await connection(connectionId)).credentialsEncrypted,
  );
  return creds.kind === 'caldav' ? creds.homeSetUrl : `kind:${creds.kind}`;
}

/** The value of an iCalendar property line, or null. */
function icsValue(ics: string, prop: string): string | null {
  const m = new RegExp(`^${prop}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(ics);
  return m?.[1]?.trim() ?? null;
}

describe('Apple write — create (D6, Q8)', () => {
  it('I9: MKCALENDAR "Raid Ledger", one copy PUT with If-None-Match: *, link stores href + etag', async () => {
    const w = await appleWriter();
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'created' });

    const calId = (await connection(w.connectionId)).dedicatedCalendarId ?? '';
    expect(calId).toMatch(/^raid-ledger-[0-9a-f-]{36}$/);
    const mk = since(mark, 'MKCALENDAR');
    expect(mk.map((r) => r.url)).toEqual([server.collectionUrl(calId)]);
    expect(mk[0]?.body).toContain('<d:displayname>Raid Ledger</d:displayname>');
    const link = await mustLink(w);
    expect(link.calendarId).toBe(calId);
    const url = objectUrlOf(link);
    const puts = since(mark, 'PUT');
    expect(puts.map((r) => [r.url, r.ifNoneMatch, r.ifMatch])).toEqual([
      [url, '*', null],
    ]);
    const obj = server.object(url);
    expect(obj?.etag).toBe(link.etag);
    const ics = obj?.ics ?? '';
    const copyId = icsValue(ics, 'X-RAID-LEDGER-ID') ?? '';
    expect(copyId).toMatch(new RegExp(`:${w.eventId}:${w.userId}$`));
    expect(icsValue(ics, 'UID')).toBe(copyId);
    expect(link.providerEventId).toBe(copyResourceName(calId, copyId));
    expect(icsValue(ics, 'TRANSP')).toBe('OPAQUE');
    expect(icsValue(ics, 'SUMMARY')).toBe('Raid Night');
  });

  it('D6: a 412 on create (lost link row) adopts the existing object — one href, If-Match retry', async () => {
    const w = await appleWriter();
    await reconcile(w);
    const first = await mustLink(w);
    const url = objectUrlOf(first);
    const etagBefore = server.object(url)?.etag ?? 'missing';
    await testApp.db
      .delete(schema.calendarEventLinks)
      .where(eq(schema.calendarEventLinks.id, first.id));
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'created' });

    expect(
      since(mark, 'PUT').map((r) => [r.url, r.ifNoneMatch, r.ifMatch]),
    ).toEqual([
      [url, '*', null],
      [url, null, etagBefore],
    ]);
    expect(since(mark, 'MKCALENDAR')).toHaveLength(0);
    const adopted = await mustLink(w);
    expect(adopted.providerEventId).toBe(first.providerEventId);
    expect(adopted.calendarId).toBe(first.calendarId);
    expect(adopted.etag).toBe(server.object(url)?.etag);
    expect(adopted.etag).not.toBe(etagBefore);
  });

  it('§2.3: a stale home set on create is rediscovered and persisted through the persister', async () => {
    const w = await appleWriter();
    await staleHomeSet(w.connectionId);
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'created' });

    expect(await storedHomeSet(w.connectionId)).toBe(FAKE_HOME_SET_URL);
    const seen = server.requests.slice(mark);
    expect(seen.some((r) => r.url.startsWith(STALE_HOME_SET_URL))).toBe(true);
    const calId = (await connection(w.connectionId)).dedicatedCalendarId ?? '';
    expect(server.ctag(calId)).not.toBeNull();
    const link = await mustLink(w);
    expect(server.object(objectUrlOf(link))?.etag).toBe(link.etag);
  });
});

describe('Apple write — update (D6)', () => {
  it('I9: tentative flip → same href, If-Match = stored etag, new etag stored, TRANSPARENT + "(Tentative) "', async () => {
    const w = await appleWriter();
    await reconcile(w);
    const before = await mustLink(w);
    await setSignupStatus(w.eventId, 'tentative');
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'updated' });

    const url = objectUrlOf(before);
    expect(
      since(mark, 'PUT').map((r) => [r.url, r.ifNoneMatch, r.ifMatch]),
    ).toEqual([[url, null, before.etag]]);
    expect(since(mark, 'MKCALENDAR')).toHaveLength(0);
    const after = await mustLink(w);
    expect(after.providerEventId).toBe(before.providerEventId);
    const obj = server.object(url);
    expect(after.etag).toBe(obj?.etag);
    expect(after.etag).not.toBe(before.etag);
    expect(icsValue(obj?.ics ?? '', 'TRANSP')).toBe('TRANSPARENT');
    expect(icsValue(obj?.ics ?? '', 'SUMMARY')).toBe('(Tentative) Raid Night');
  });
});

describe('Apple write — delete (D6)', () => {
  it('a declined sign-up DELETEs the copy with If-Match = stored etag; link gone', async () => {
    const w = await appleWriter();
    await reconcile(w);
    const link = await mustLink(w);
    const url = objectUrlOf(link);
    await setSignupStatus(w.eventId, 'declined');
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'deleted' });

    expect(since(mark, 'DELETE').map((r) => [r.url, r.ifMatch])).toEqual([
      [url, link.etag],
    ]);
    expect(server.object(url)).toBeNull();
    expect(await linkOf(w)).toBeNull();
  });

  it('a 404 at a stale home set → rediscovery → 404 again counts as done; home set persisted', async () => {
    const w = await appleWriter();
    await reconcile(w);
    const link = await mustLink(w);
    const url = objectUrlOf(link);
    // The user deleted the copy in Apple Calendar.
    const gone = await server.handle({
      method: 'DELETE',
      url,
      auth: FAKE_CALDAV_CREDENTIALS,
    });
    expect(gone.status).toBe(204);
    await staleHomeSet(w.connectionId);
    await setSignupStatus(w.eventId, 'declined');
    const mark = server.requests.length;

    expect(await reconcile(w)).toEqual({ result: 'deleted' });

    const staleUrl = `${STALE_HOME_SET_URL}${link.calendarId}/${link.providerEventId}`;
    expect(since(mark, 'DELETE').map((r) => r.url)).toEqual([staleUrl, url]);
    expect(await linkOf(w)).toBeNull();
    expect(await storedHomeSet(w.connectionId)).toBe(FAKE_HOME_SET_URL);
  });
});

describe('Apple write — disconnect (D7)', () => {
  it('the disconnect job DELETEs the dedicated "Raid Ledger" calendar', async () => {
    const w = await appleWriter();
    await reconcile(w);
    const calId = (await connection(w.connectionId)).dedicatedCalendarId ?? '';
    expect(server.ctag(calId)).not.toBeNull();

    const res = await testApp.request
      .delete(`/users/me/calendars/${w.connectionId}`)
      .set('Authorization', `Bearer ${w.token}`);
    expect(res.status).toBe(202);
    const jobId = disconnectJobId(w.connectionId);
    const job = await writeQueue.getJob(jobId);
    expect(job?.id).toBe(jobId);
    if (!job) throw new Error(`no queued disconnect job ${jobId}`);
    const mark = server.requests.length;
    try {
      await processor.process(job);
    } finally {
      await writeQueue.remove(jobId);
    }

    expect(since(mark, 'DELETE').map((r) => r.url)).toContain(
      server.collectionUrl(calId),
    );
    expect(server.ctag(calId)).toBeNull();
    const rows = await testApp.db
      .select()
      .from(conns)
      .where(eq(conns.id, w.connectionId));
    expect(rows).toHaveLength(0);
  });
});
