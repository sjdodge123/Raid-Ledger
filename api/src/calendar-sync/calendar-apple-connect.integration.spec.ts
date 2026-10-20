/**
 * ROK-1598 I1–I6 + D13: `POST /users/me/calendars/apple` against Postgres.
 *
 * iCloud is the in-process `FakeCalDavServer` behind a namespace spy on
 * `caldavFetch` (`jest.mock` never reaches the singleton app); everything
 * else is real — the JWT guard, the kill switch, the schema check, the
 * error mapping, the encrypted upsert and the post-connect read job.
 *
 * The app's read + write WORKERS are closed for the file so the queued jobs
 * stay put for the assertions (the app is per file).
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
import { APPLE_CONNECT_LIMIT } from './controllers/calendar-apple-throttle.helpers';
import * as appleHttp from './providers/apple/apple-caldav-http';
import {
  FAKE_CALDAV_CREDENTIALS,
  FAKE_HOME_SET_URL,
  FAKE_PRINCIPAL_URL,
  FakeCalDavServer,
} from './providers/apple/apple-caldav.spec-helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
  isEncryptedCredentials,
} from './services/calendar-credentials.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';

const ROUTE = '/users/me/calendars/apple';
const EMAIL = FAKE_CALDAV_CREDENTIALS.username;
const PASSWORD = FAKE_CALDAV_CREDENTIALS.appPassword;
const ORIGINAL_THROTTLE = process.env.THROTTLE_DISABLED;

let testApp: TestApp;
let settings: SettingsService;
let readQueue: Queue;
let writeQueue: Queue;
let server: FakeCalDavServer;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_READ_QUEUE));
  writeQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  await testApp.app.get(CalendarReadProcessor).worker.close(true);
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
  if (ORIGINAL_THROTTLE === undefined) delete process.env.THROTTLE_DISABLED;
  else process.env.THROTTLE_DISABLED = ORIGINAL_THROTTLE;
  await readQueue.drain(true);
  await writeQueue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A fresh member: a new user id, so the per-user limiter starts empty. */
async function member(): Promise<{ userId: number; token: string }> {
  seq += 1;
  return createMemberAndLogin(
    testApp,
    `cal-apple-${seq}`,
    `cal-apple-${seq}@example.test`,
  );
}

function connect(token: string, body: unknown) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);
}

const conns = schema.calendarConnections;

function rowsOf(userId: number) {
  return testApp.db.select().from(conns).where(eq(conns.userId, userId));
}

async function onlyRow(userId: number) {
  const [row] = nonEmpty(await rowsOf(userId), 'apple connection');
  return row;
}

describe('POST /users/me/calendars/apple — connect', () => {
  it('I1: 201 + the connection, credentials stored only encrypted, a read job queued', async () => {
    const { userId, token } = await member();

    const res = await connect(token, { email: EMAIL, appPassword: PASSWORD });

    expect(res.status).toBe(201);
    const row = await onlyRow(userId);
    expect(res.body).toMatchObject({
      id: row.id,
      provider: 'apple',
      accountLabel: EMAIL,
      status: 'active',
      errorCode: null,
      read: { enabled: true },
      write: { enabled: false },
    });
    expect(row.accountSubject).toBe(EMAIL.toLowerCase());
    expect(row.readAccessGranted).toBe(true);
    expect(isEncryptedCredentials(row.credentialsEncrypted)).toBe(true);
    expect(row.credentialsEncrypted).not.toContain(PASSWORD);
    expect(row.credentialsEncrypted).not.toContain(EMAIL);
    expect(decryptCalendarCredentials(row.credentialsEncrypted)).toEqual({
      kind: 'caldav',
      username: EMAIL,
      appPassword: PASSWORD,
      principalUrl: FAKE_PRINCIPAL_URL,
      homeSetUrl: FAKE_HOME_SET_URL,
    });
    const job = await readQueue.getJob(readSyncJobId(row.id));
    expect(job?.data).toEqual({ kind: 'sync', connectionId: row.id });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it('I2: iCloud answers 401 → 400 apple_auth_failed, no row, no input echoed', async () => {
    const { userId, token } = await member();
    server.failNext('auth');

    const res = await connect(token, { email: EMAIL, appPassword: PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'apple_auth_failed' });
    expect(res.text).not.toContain(EMAIL);
    expect(res.text).not.toContain(PASSWORD);
    expect(await rowsOf(userId)).toEqual([]);
    expect(await readQueue.getJobs(['waiting', 'delayed'])).toEqual([]);
  });

  it('I2b: a wrong password (the fake refuses the login) → 400 apple_auth_failed', async () => {
    const { userId, token } = await member();

    const res = await connect(token, {
      email: EMAIL,
      appPassword: 'zzzz-zzzz-zzzz-zzzz',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'apple_auth_failed' });
    expect(res.text).not.toContain('zzzz-zzzz-zzzz-zzzz');
    expect(await rowsOf(userId)).toEqual([]);
  });

  it('I3: a malformed password → 400 invalid_input fields [appPassword], nothing sent to iCloud', async () => {
    const { userId, token } = await member();

    const res = await connect(token, { email: EMAIL, appPassword: 'hunter2' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'invalid_input',
      fields: ['appPassword'],
    });
    expect(res.text).not.toContain('hunter2');
    expect(server.requests).toEqual([]);
    expect(await rowsOf(userId)).toEqual([]);
  });

  it('I3b: a bad email and an unknown key are both listed in fields', async () => {
    const { token } = await member();

    const res = await connect(token, {
      email: 'not-an-email',
      appPassword: PASSWORD,
      extra: 1,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_input');
    expect([...(res.body.fields as string[])].sort()).toEqual(['', 'email']);
    expect(server.requests).toEqual([]);
  });

  it('I4: reconnecting the same email (upper-cased) → 200, same row, active, settings kept', async () => {
    const { userId, token } = await member();
    const first = await connect(token, { email: EMAIL, appPassword: PASSWORD });
    expect(first.status).toBe(201);
    const id = (await onlyRow(userId)).id;
    await testApp.db
      .update(conns)
      .set({
        status: 'needs_reconnect',
        lastErrorCode: 'auth',
        readCalendarIds: ['home', 'shared-ro'],
        writeEnabled: true,
        credentialsEncrypted: encryptCalendarCredentials({
          kind: 'caldav',
          username: EMAIL,
          appPassword: 'stal-ecre-dent-ials',
        }),
      })
      .where(eq(conns.id, id));
    await readQueue.drain(true);
    // iCloud treats the Apple ID case-insensitively; the fake compares it
    // exactly, so it accepts the upper-cased login for the reconnect.
    server = new FakeCalDavServer({
      username: EMAIL.toUpperCase(),
      appPassword: PASSWORD,
    });
    jest.spyOn(appleHttp, 'caldavFetch').mockImplementation(server.handle);

    const res = await connect(token, {
      email: EMAIL.toUpperCase(),
      appPassword: PASSWORD,
    });

    expect({ status: res.status, body: res.body }).toMatchObject({
      status: 200,
      body: { id },
    });
    expect(res.body).toMatchObject({
      id,
      status: 'active',
      errorCode: null,
      read: { enabled: true, calendarIds: ['home', 'shared-ro'] },
      write: { enabled: true },
    });
    const rows = await rowsOf(userId);
    expect(rows.map((r) => r.id)).toEqual([id]);
    const [row] = nonEmpty(rows, 'reconnected row');
    expect(row.status).toBe('active');
    expect(row.lastErrorCode).toBeNull();
    expect(row.readCalendarIds).toEqual(['home', 'shared-ro']);
    expect(row.writeEnabled).toBe(true);
    const creds = decryptCalendarCredentials(row.credentialsEncrypted);
    expect(creds).toMatchObject({ kind: 'caldav', appPassword: PASSWORD });
    const job = await readQueue.getJob(readSyncJobId(id));
    expect({ reconnectReadSyncQueued: job?.id }).toEqual({
      reconnectReadSyncQueued: readSyncJobId(id),
    });
  });

  it.each([
    ['iCloud 503', (s: FakeCalDavServer) => s.failNext('transient')],
    [
      'a network failure / timeout',
      (s: FakeCalDavServer) => s.failNext('network'),
    ],
    ['iCloud 429', (s: FakeCalDavServer) => s.failNext('rate')],
    [
      'a redirect off iCloud',
      (s: FakeCalDavServer) => s.redirectTo('https://evil.example/steal'),
    ],
  ])('I5: %s → 503 apple_unavailable, no row', async (_label, arrange) => {
    const { userId, token } = await member();
    arrange(server);

    const res = await connect(token, { email: EMAIL, appPassword: PASSWORD });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'apple_unavailable' });
    expect(res.text).not.toContain(PASSWORD);
    expect(await rowsOf(userId)).toEqual([]);
    expect(server.requests.map((r) => r.host)).not.toContain('evil.example');
  });

  it('I6: the kill switch off → 404, nothing sent to iCloud', async () => {
    const { userId, token } = await member();
    await setCalendarSyncEnabled(settings, false);

    const res = await connect(token, { email: EMAIL, appPassword: PASSWORD });

    expect(res.status).toBe(404);
    expect(server.requests).toEqual([]);
    expect(await rowsOf(userId)).toEqual([]);
  });

  it('requires a session → 401', async () => {
    const res = await testApp.request
      .post(ROUTE)
      .send({ email: EMAIL, appPassword: PASSWORD });

    expect(res.status).toBe(401);
    expect(server.requests).toEqual([]);
  });
});

describe('POST /users/me/calendars/apple — D13 limiter', () => {
  it(`allows ${APPLE_CONNECT_LIMIT} attempts per user in 10 min, then 429; another user is unaffected`, async () => {
    const limited = await member();
    const other = await member();
    process.env.THROTTLE_DISABLED = 'false';
    const bad = { email: EMAIL, appPassword: 'hunter2' };

    const statuses: number[] = [];
    for (let i = 0; i < APPLE_CONNECT_LIMIT + 1; i++) {
      statuses.push((await connect(limited.token, bad)).status);
    }
    const otherStatus = (await connect(other.token, bad)).status;

    expect(statuses).toEqual([
      ...Array.from({ length: APPLE_CONNECT_LIMIT }, () => 400),
      429,
    ]);
    expect(otherStatus).toBe(400);
    expect(server.requests).toEqual([]);
  });
});
