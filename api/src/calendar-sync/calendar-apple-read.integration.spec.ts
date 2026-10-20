/**
 * ROK-1598 I7, I8, I10 + D5/D7 + §2.3 rediscovery: the calendar read
 * pipeline for an Apple (CalDAV) connection against Postgres.
 *
 * iCloud is the in-process `FakeCalDavServer` behind a namespace spy on
 * `caldavFetch`. The connection is made through the real
 * `POST /users/me/calendars/apple` route, and each queued read job is run
 * through `CalendarReadProcessor.process` (the app's read + write WORKERS
 * are closed for the file, as in the A9 spec, so no job runs concurrently).
 *
 * Fixture times are TOMORROW (UTC) so they sit inside the read window.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  readSyncJobId,
} from './calendar-sync.constants';
import * as appleHttp from './providers/apple/apple-caldav-http';
import {
  FAKE_CALDAV_CREDENTIALS,
  FAKE_HOME_SET_URL,
  FakeCalDavServer,
} from './providers/apple/apple-caldav.spec-helpers';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from './providers/testing/fake-calendar-store';
import {
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './read/calendar-read.enqueue.helpers';
import {
  resetFake,
  timed,
  tomorrowAt,
} from './read/calendar-read.integration.spec-helpers';
import { purgeAllCalendarReadData } from './read/calendar-read-purge.helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './services/calendar-credentials.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
/** A home set on another DSID: every path under it 404s on the fake. */
const STALE_HOME_SET_URL = 'https://p07-caldav.icloud.com/7654321/calendars/';

let testApp: TestApp;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let writeQueue: Queue;
let readProcessor: CalendarReadProcessor;
let server: FakeCalDavServer;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue<CalendarReadJobData>>(
    getQueueToken(CALENDAR_READ_QUEUE),
  );
  writeQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  readProcessor = testApp.app.get(CalendarReadProcessor);
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
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
  await readQueue.clean(0, 1000, 'failed');
  await readQueue.clean(0, 1000, 'completed');
  await writeQueue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  await settings.setDemoMode(false);
  testApp.seed = await truncateAllTables(testApp.db);
});

const conns = schema.calendarConnections;

interface AppleMember {
  userId: number;
  token: string;
  connectionId: number;
}

/** A member who connected iCloud through the route (read on, job queued). */
async function appleMember(): Promise<AppleMember> {
  seq += 1;
  const { userId, token } = await createMemberAndLogin(
    testApp,
    `cal-apple-read-${seq}`,
    `cal-apple-read-${seq}@example.test`,
  );
  const res = await testApp.request
    .post('/users/me/calendars/apple')
    .set('Authorization', `Bearer ${token}`)
    .send({
      email: FAKE_CALDAV_CREDENTIALS.username,
      appPassword: FAKE_CALDAV_CREDENTIALS.appPassword,
    });
  expect(res.status).toBe(201);
  return { userId, token, connectionId: Number(res.body.id) };
}

/** Run the queued read job for `connectionId` through the processor. */
async function processQueued(connectionId: number): Promise<unknown> {
  const jobId = readSyncJobId(connectionId);
  const job = await readQueue.getJob(jobId);
  expect(job?.id).toBe(jobId);
  if (!job) throw new Error(`no queued read job ${jobId}`);
  try {
    return await readProcessor.process(job);
  } finally {
    await readQueue.remove(jobId);
  }
}

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
    .select({ id: t.id, startsAt: t.startsAt, endsAt: t.endsAt })
    .from(t)
    .where(eq(t.connectionId, connectionId))
    .orderBy(t.startsAt);
}

async function connection(id: number) {
  const rows = await testApp.db.select().from(conns).where(eq(conns.id, id));
  const [row] = nonEmpty(rows, 'connection');
  return row;
}

function reportsSince(mark: number) {
  return server.requests.slice(mark).filter((r) => r.method === 'REPORT');
}

describe('Apple read sync', () => {
  it('a first sync writes the busy block from the default (primary) calendar', async () => {
    const m = await appleMember();
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    server.seedEvent('home', {
      start: tomorrowAt(22),
      end: tomorrowAt(23),
      busy: false,
    });
    server.seedEvent('shared-ro', {
      start: tomorrowAt(10),
      end: tomorrowAt(11),
      busy: true,
    });

    expect(await processQueued(m.connectionId)).toBe('synced');

    const blocks = await blocksOf(m.connectionId);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(19), tomorrowAt(21)],
    ]);
    const row = await connection(m.connectionId);
    expect(row.status).toBe('active');
    expect(row.lastErrorCode).toBeNull();
    expect(row.lastSyncedAt).not.toBeNull();
    expect(row.syncCursor).not.toBeNull();
  });

  it('I7: a second sync with unchanged ctags → unchanged, blocks kept, no REPORT', async () => {
    const m = await appleMember();
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    expect(await processQueued(m.connectionId)).toBe('synced');
    const before = await connection(m.connectionId);
    const blocksBefore = await blocksOf(m.connectionId);
    expect(blocksBefore).toHaveLength(1);
    const mark = server.requests.length;

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('unchanged');

    expect(reportsSince(mark)).toEqual([]);
    expect(await blocksOf(m.connectionId)).toEqual(blocksBefore);
    const after = await connection(m.connectionId);
    expect(after.syncCursor).toEqual(before.syncCursor);
    expect(after.lastSyncedAt?.getTime()).toBeGreaterThan(
      before.lastSyncedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it('D7: kill switch off (purge) → on → the next sync re-reads and rewrites the blocks', async () => {
    const m = await appleMember();
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    expect(await processQueued(m.connectionId)).toBe('synced');
    await setCalendarSyncEnabled(settings, false);
    await purgeAllCalendarReadData(testApp.db);
    expect(await blocksOf(m.connectionId)).toEqual([]);
    expect((await connection(m.connectionId)).syncCursor).toBeNull();
    await setCalendarSyncEnabled(settings, true);
    const mark = server.requests.length;

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('synced');

    expect(reportsSince(mark)).toHaveLength(1);
    const blocks = await blocksOf(m.connectionId);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(19), tomorrowAt(21)],
    ]);
  });

  it('D7: a bumped ctag → a full re-read that replaces the blocks', async () => {
    const m = await appleMember();
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    expect(await processQueued(m.connectionId)).toBe('synced');
    const before = await connection(m.connectionId);
    server.seedEvent('home', {
      start: tomorrowAt(8),
      end: tomorrowAt(9),
      busy: true,
    });
    const mark = server.requests.length;

    await enqueue(m.connectionId);
    expect(await processQueued(m.connectionId)).toBe('synced');

    expect(reportsSince(mark)).toHaveLength(1);
    const blocks = await blocksOf(m.connectionId);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(8), tomorrowAt(9)],
      [tomorrowAt(19), tomorrowAt(21)],
    ]);
    expect((await connection(m.connectionId)).syncCursor).not.toEqual(
      before.syncCursor,
    );
  });

  it('I8: iCloud answers 401 → needs_reconnect + last_error_code auth, shown in the overview', async () => {
    const m = await appleMember();
    server.failNext('auth');

    await expect(processQueued(m.connectionId)).rejects.toThrow(
      'calendar read sync: auth',
    );

    const row = await connection(m.connectionId);
    expect(row.status).toBe('needs_reconnect');
    expect(row.lastErrorCode).toBe('auth');
    const res = await testApp.request
      .get('/users/me/calendars')
      .set('Authorization', `Bearer ${m.token}`);
    expect(res.status).toBe(200);
    const listed = (res.body.connections as { id: number }[]).find(
      (c) => c.id === m.connectionId,
    );
    expect(listed).toMatchObject({
      provider: 'apple',
      status: 'needs_reconnect',
      errorCode: 'auth',
    });
  });

  it('D5: a selected calendar deleted in iCloud is pruned; the rest still syncs', async () => {
    const m = await appleMember();
    server.addCalendar('work', { displayName: 'Work' });
    await testApp.db
      .update(conns)
      .set({ readCalendarIds: ['home', 'work'] })
      .where(eq(conns.id, m.connectionId));
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });
    server.removeCalendar('work');

    expect(await processQueued(m.connectionId)).toBe('synced');

    const row = await connection(m.connectionId);
    expect(row.readCalendarIds).toEqual(['home']);
    expect(row.readEnabled).toBe(true);
    expect(row.lastErrorCode).toBeNull();
    const blocks = await blocksOf(m.connectionId);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(19), tomorrowAt(21)],
    ]);
  });

  it('§2.3: a stale home set (partition move) is rediscovered and persisted to the row', async () => {
    const m = await appleMember();
    const stored = decryptCalendarCredentials(
      (await connection(m.connectionId)).credentialsEncrypted,
    );
    expect(stored.kind).toBe('caldav');
    if (stored.kind !== 'caldav') throw new Error('not caldav credentials');
    await testApp.db
      .update(conns)
      .set({
        credentialsEncrypted: encryptCalendarCredentials({
          ...stored,
          homeSetUrl: STALE_HOME_SET_URL,
        }),
      })
      .where(eq(conns.id, m.connectionId));
    server.seedEvent('home', {
      start: tomorrowAt(19),
      end: tomorrowAt(21),
      busy: true,
    });

    expect(await processQueued(m.connectionId)).toBe('synced');

    const after = decryptCalendarCredentials(
      (await connection(m.connectionId)).credentialsEncrypted,
    );
    expect(after).toMatchObject({
      kind: 'caldav',
      homeSetUrl: FAKE_HOME_SET_URL,
      appPassword: FAKE_CALDAV_CREDENTIALS.appPassword,
    });
    expect(
      server.requests.some((r) => r.url.startsWith(STALE_HOME_SET_URL)),
    ).toBe(true);
    const blocks = await blocksOf(m.connectionId);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(19), tomorrowAt(21)],
    ]);
  });
});

describe('Google read sync — no D7 regression', () => {
  it('I10: a Google (Fake) row syncs and keeps sync_cursor null', async () => {
    process.env.DEMO_MODE = 'true';
    await settings.setDemoMode(true);
    const fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
    resetFake(fake);
    seq += 1;
    const { userId } = await createMemberAndLogin(
      testApp,
      `cal-google-read-${seq}`,
      `cal-google-read-${seq}@example.test`,
    );
    const { id } = await upsertCalendarConnection(testApp.db, {
      userId,
      provider: 'google',
      result: fake.seedConnection({ id: `apple-i10-${seq}` }),
    });
    await testApp.db
      .update(conns)
      .set({ readAccessGranted: true, readEnabled: true })
      .where(eq(conns.id, id));
    fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
      timed(tomorrowAt(21), tomorrowAt(22)),
    ]);
    await enqueue(id);

    expect(await processQueued(id)).toBe('synced');
    await enqueue(id);
    expect(await processQueued(id)).toBe('synced');

    const row = await connection(id);
    expect(row.syncCursor).toBeNull();
    expect(row.status).toBe('active');
    const blocks = await blocksOf(id);
    expect(blocks.map((b) => [b.startsAt, b.endsAt])).toEqual([
      [tomorrowAt(21), tomorrowAt(22)],
    ]);
    expect(server.requests).toEqual([]);
  });
});
