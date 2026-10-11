/**
 * ROK-1592: `DELETE /users/me/calendars/:id` + the DEMO_MODE seed endpoint
 * against Postgres (plan L9/L15, ruling Q-E). Google revoke is a
 * `googleHttp.googleFormPost` spy.
 *
 * ROK-1596 D7 (F2): DELETE now marks the row `disconnecting` and queues a
 * `disconnect` job. The worker is paused; each test runs the queued job
 * through `CalendarWriteProcessor.process`, and the row-gone / revoke
 * assertions sit AFTER the job body (moved, not weakened).
 */
import { eq } from 'drizzle-orm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../events/signups.integration.spec-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import {
  CALENDAR_WRITE_QUEUE,
  disconnectJobId,
} from './calendar-sync.constants';
import * as googleHttp from './providers/google/google-http';
import type { CalendarWriteJobData } from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import {
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
  GOOGLE_REVOKE_URL,
} from './providers/google/google-oauth.helpers';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from './providers/testing/fake-calendar-store';
import {
  ProviderAuthError,
  TransientError,
} from './providers/calendar-provider.errors';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './services/calendar-credentials.helpers';
import {
  enableGoogle,
  fixture,
  formsSentTo,
  stubGoogle,
} from './calendar-oauth.integration.spec-helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const SEED = '/admin/test/calendar/seed-connection';

function restoreDemoMode(): void {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
}

let testApp: TestApp;
let processor: CalendarWriteProcessor;
let queue: Queue;
let adminToken: string;
let alice: { userId: number; token: string };
let bob: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  // Booted with whatever DEMO_MODE the run has (integration-setup.ts boots the
  // singleton first anyway): demo mode is decided per request (L15).
  testApp = await getTestApp();
  processor = testApp.app.get(CalendarWriteProcessor);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  await processor.worker.pause(true);
  await flushInFlightFetch();
});

/**
 * `pause(true)` does not cancel the worker's in-flight blocking fetch: the
 * FIRST job added afterwards is still processed by the worker, racing the
 * explicit `processor.process` below (observed: a double revoke). Feed that
 * fetch a harmless job (no such connection → `{found:false}`) and wait,
 * bounded, until it is consumed; if no fetch was in flight it is drained.
 */
async function flushInFlightFetch(): Promise<void> {
  const data: CalendarWriteJobData = { kind: 'disconnect', connectionId: 0 };
  await queue.add('disconnect', data, {
    jobId: 'a7-flush',
    removeOnComplete: true,
    removeOnFail: true,
  });
  for (let i = 0; i < 30 && (await queue.getJob('a7-flush')); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await queue.drain(true);
}

afterAll(() => processor.worker.resume());

beforeEach(async () => {
  await queue.drain(true); // ids repeat across truncations
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableGoogle(testApp);
  seq += 1;
  alice = await createMemberAndLogin(
    testApp,
    `cal-dc-a${seq}`,
    `cal-dc-a${seq}@example.test`,
  );
  bob = await createMemberAndLogin(
    testApp,
    `cal-dc-b${seq}`,
    `cal-dc-b${seq}@example.test`,
  );
  stubGoogle({ token: { status: 200, json: fixture('token-ok') } });
});

afterEach(async () => {
  jest.restoreAllMocks();
  restoreDemoMode();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertConnection(
  userId: number,
  subject: string,
  refreshToken: string,
) {
  const credentialsEncrypted = encryptCalendarCredentials({
    kind: 'oauth',
    accessToken: `ya29.access-${subject}`,
    refreshToken,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scopes: [GOOGLE_CALENDAR_APP_CREATED_SCOPE],
  });
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.calendarConnections)
      .values({
        userId,
        provider: 'google',
        accountSubject: subject,
        accountLabel: `${subject}@example.test`,
        credentialsEncrypted,
      })
      .returning(),
    'calendar connection',
  );
  return row;
}

async function insertLink(connectionId: number, userId: number) {
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.db.insert(schema.calendarEventLinks).values({
    connectionId,
    userId,
    eventId,
    calendarId: 'rl-dedicated',
    providerEventId: `prov-${connectionId}`,
  });
}

function connectionById(id: number) {
  return testApp.db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.id, id));
}

function linksOf(connectionId: number) {
  return testApp.db
    .select()
    .from(schema.calendarEventLinks)
    .where(eq(schema.calendarEventLinks.connectionId, connectionId));
}

function del(id: number, token: string) {
  return testApp.request
    .delete(`/users/me/calendars/${id}`)
    .set('Authorization', `Bearer ${token}`);
}

/** Run the queued `disconnect` job for `id` through the processor. */
async function runDisconnectJob(id: number): Promise<unknown> {
  const jobId = disconnectJobId(id);
  const job = (await queue.getJob(jobId)) as Job<CalendarWriteJobData>;
  expect(job?.id).toBe(jobId);
  const outcome = await processor.process(job);
  await queue.remove(jobId);
  return outcome;
}

/** Calendar API calls (copy / calendar deletes) answer 204. */
function stubGoogleJson(): jest.SpyInstance {
  return jest
    .spyOn(googleHttp, 'googleJsonRequest')
    .mockResolvedValue({ status: 204, json: null, retryAfter: null });
}

function googleSpy(): jest.SpyInstance {
  jest.restoreAllMocks();
  return stubGoogle({ token: { status: 200, json: {} } });
}

describe('DELETE /users/me/calendars/:id', () => {
  it("404s on another user's connection and leaves it in place", async () => {
    const row = await insertConnection(
      bob.userId,
      `sub-bob-${seq}`,
      'refresh-bob',
    );
    expect((await del(row.id, alice.token)).status).toBe(404);
    expect(await connectionById(row.id)).toHaveLength(1);
  });

  it('202s, deletes the row, cascades its links and revokes the refresh token', async () => {
    const spy = googleSpy();
    const row = await insertConnection(
      alice.userId,
      `sub-alice-${seq}`,
      'refresh-alice',
    );
    const json = stubGoogleJson();
    await insertLink(row.id, alice.userId);
    expect(await linksOf(row.id)).toHaveLength(1);
    expect((await del(row.id, alice.token)).status).toBe(202);
    // D7: the request only marks the row; nothing remote has happened yet.
    const [marked] = await connectionById(row.id);
    expect(marked?.status).toBe('disconnecting');
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
    await runDisconnectJob(row.id);
    expect(await connectionById(row.id)).toHaveLength(0);
    expect(await linksOf(row.id)).toHaveLength(0);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: 'refresh-alice' },
    ]);
    // Q5: the copy (outside any dedicated calendar) was deleted on Google.
    const calls = json.mock.calls as [string, string][];
    expect(
      calls.map(([m, url]) => [m, url.split('/').slice(-3).join('/')]),
    ).toEqual([['DELETE', `rl-dedicated/events/prov-${row.id}`]]);
  });

  it('still 202s and deletes when Google revoke answers 500', async () => {
    jest.restoreAllMocks();
    const spy = stubGoogle({
      token: { status: 200, json: {} },
      revokeStatus: 500,
    });
    const row = await insertConnection(
      alice.userId,
      `sub-alice-${seq}`,
      'refresh-alice',
    );
    expect((await del(row.id, alice.token)).status).toBe(202);
    await runDisconnectJob(row.id);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toHaveLength(1);
    expect(await connectionById(row.id)).toHaveLength(0);
  });

  it('skips the revoke while another user holds the same Google account (Q-D)', async () => {
    const spy = googleSpy();
    const shared = `sub-shared-${seq}`;
    const mine = await insertConnection(alice.userId, shared, 'refresh-shared');
    const theirs = await insertConnection(bob.userId, shared, 'refresh-shared');
    expect((await del(mine.id, alice.token)).status).toBe(202);
    await runDisconnectJob(mine.id);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toHaveLength(0);
    expect(await connectionById(mine.id)).toHaveLength(0);
    expect(await connectionById(theirs.id)).toHaveLength(1);
  });

  it('the last holder of a shared Google account disconnecting → revoke runs', async () => {
    const spy = googleSpy();
    const shared = `sub-shared-${seq}`;
    const mine = await insertConnection(alice.userId, shared, 'refresh-shared');
    const theirs = await insertConnection(bob.userId, shared, 'refresh-shared');
    expect((await del(mine.id, alice.token)).status).toBe(202);
    await runDisconnectJob(mine.id);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toHaveLength(0);
    expect((await del(theirs.id, bob.token)).status).toBe(202);
    await runDisconnectJob(theirs.id);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: 'refresh-shared' },
    ]);
    expect(await connectionById(theirs.id)).toHaveLength(0);
  });

  it('still works with the kill switch OFF (ruling Q-E)', async () => {
    await setCalendarSyncEnabled(testApp.app.get(SettingsService), false);
    const row = await insertConnection(
      alice.userId,
      `sub-alice-${seq}`,
      'refresh-alice',
    );
    expect((await del(row.id, alice.token)).status).toBe(202);
    await runDisconnectJob(row.id); // cleanup kinds are queued with the switch off
    expect(await connectionById(row.id)).toHaveLength(0);
  });

  it('401s without a JWT', async () => {
    const row = await insertConnection(
      alice.userId,
      `sub-alice-${seq}`,
      'refresh-alice',
    );
    expect(
      (await testApp.request.delete(`/users/me/calendars/${row.id}`)).status,
    ).toBe(401);
  });
});

describe('POST /admin/test/calendar/seed-connection', () => {
  async function demoKeys(env: boolean, setting: boolean): Promise<void> {
    if (env) process.env.DEMO_MODE = 'true';
    else delete process.env.DEMO_MODE;
    await testApp.app.get(SettingsService).setDemoMode(setting);
  }

  it('403s when env DEMO_MODE is off, even with the setting on', async () => {
    await demoKeys(false, true);
    const res = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('403s when the demo_mode setting is off', async () => {
    await demoKeys(true, false);
    const res = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('403s for a non-admin', async () => {
    await demoKeys(true, true);
    const res = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('seeds a demo-fake: row for the caller; DELETE goes through the Fake, not Google', async () => {
    await demoKeys(true, true);
    const res = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accountLabel: 'demo@example.test' });
    expect(res.status).toBe(201);
    const id = (res.body as { id: number }).id;
    const [row] = nonEmpty(await connectionById(id), 'seeded connection');
    expect(row).toMatchObject({
      userId: testApp.seed.adminUser.id,
      provider: 'google',
      accountLabel: 'demo@example.test',
    });
    expect(row.accountSubject.startsWith('demo-fake:')).toBe(true);
    const creds = decryptCalendarCredentials(row.credentialsEncrypted);
    const spy = googleSpy();
    expect((await del(id, adminToken)).status).toBe(202);
    await runDisconnectJob(id);
    expect(spy).not.toHaveBeenCalled();
    const fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
    expect(fake).toBeInstanceOf(FakeCalendarProvider);
    expect(fake.revoked).toContain(
      creds.kind === 'oauth' ? creds.refreshToken : 'not-oauth',
    );
    expect(await connectionById(id)).toHaveLength(0);
  });
});

describe('disconnect job — remote cleanup (D7, Q5) against the Fake', () => {
  let fake: FakeCalendarProvider;

  beforeEach(async () => {
    fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
    for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
  });

  afterEach(() => testApp.app.get(SettingsService).setDemoMode(false));

  /** A demo-fake row for `userId`; same `account` → same subject (siblings). */
  async function fakeConnection(userId: number, account = `dc-${seq}`) {
    const result = fake.seedConnection({ id: account });
    const { id } = await upsertCalendarConnection(testApp.db, {
      userId,
      provider: 'google',
      result,
    });
    return { id, result };
  }

  /** One fake copy in `calendarId` + its link row; returns the copy id. */
  async function copyIn(
    connectionId: number,
    userId: number,
    calendarId: string,
  ) {
    const eventId = await createFutureEvent(testApp, adminToken);
    const copy = fake.store.upsertCopy(
      calendarId,
      {
        copyId: `rl-${eventId}`,
        title: 'Raid',
        description: '',
        url: '',
        busy: true,
        start: new Date(),
        end: new Date(Date.now() + 3600_000),
      },
      null,
    );
    await testApp.db.insert(schema.calendarEventLinks).values({
      connectionId,
      userId,
      eventId,
      calendarId,
      providerEventId: copy.id,
    });
    return copy.id;
  }

  async function withDedicated(connectionId: number): Promise<string> {
    const calendarId = fake.store.createCalendar('Raid Ledger');
    await testApp.db
      .update(schema.calendarConnections)
      .set({ dedicatedCalendarId: calendarId })
      .where(eq(schema.calendarConnections.id, connectionId));
    return calendarId;
  }

  it('the overview omits a disconnecting row before the job runs', async () => {
    const { id } = await fakeConnection(alice.userId);
    expect((await del(id, alice.token)).status).toBe(202);
    const res = await testApp.request
      .get('/users/me/calendars')
      .set('Authorization', `Bearer ${alice.token}`);
    const ids = (res.body as { connections: { id: number }[] }).connections;
    expect(ids.map((c) => c.id)).not.toContain(id);
    expect(await connectionById(id)).toHaveLength(1);
  });

  it('primary-target copies are deleted, then the row', async () => {
    const { id } = await fakeConnection(alice.userId);
    await copyIn(id, alice.userId, FAKE_PRIMARY_CALENDAR_ID);
    await copyIn(id, alice.userId, FAKE_PRIMARY_CALENDAR_ID);
    expect((await del(id, alice.token)).status).toBe(202);
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toHaveLength(2);
    expect(await runDisconnectJob(id)).toEqual({
      found: true,
      remote: 'cleaned',
      revoke: 'revoked',
    });
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toEqual([]);
    expect(await connectionById(id)).toHaveLength(0);
  });

  it('the dedicated "Raid Ledger" calendar is deleted', async () => {
    const { id } = await fakeConnection(alice.userId);
    const calendarId = await withDedicated(id);
    await copyIn(id, alice.userId, calendarId);
    expect((await del(id, alice.token)).status).toBe(202);
    await runDisconnectJob(id);
    expect(fake.store.hasCalendar(calendarId)).toBe(false);
    expect(fake.store.allCopies()).toEqual([]);
    expect(await connectionById(id)).toHaveLength(0);
  });

  it('auth error → remote cleanup skipped, row still deleted + revoke, no throw', async () => {
    const { id, result } = await fakeConnection(alice.userId);
    const calendarId = await withDedicated(id);
    await copyIn(id, alice.userId, FAKE_PRIMARY_CALENDAR_ID);
    await copyIn(id, alice.userId, FAKE_PRIMARY_CALENDAR_ID);
    fake.store.failNext(new ProviderAuthError('invalid_grant'));
    expect((await del(id, alice.token)).status).toBe(202);
    expect(await runDisconnectJob(id)).toEqual({
      found: true,
      remote: 'skipped_auth',
      revoke: 'revoked',
    });
    // The first delete hit the auth error; nothing further was attempted.
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toHaveLength(2);
    expect(fake.store.hasCalendar(calendarId)).toBe(true);
    expect(await connectionById(id)).toHaveLength(0);
    const refresh =
      result.credentials.kind === 'oauth'
        ? result.credentials.refreshToken
        : '';
    expect(fake.revoked).toContain(refresh);
  });

  it('a transient error rethrows for retry and keeps the row', async () => {
    const { id } = await fakeConnection(alice.userId);
    await copyIn(id, alice.userId, FAKE_PRIMARY_CALENDAR_ID);
    fake.store.failNext(new TransientError('http_503'));
    expect((await del(id, alice.token)).status).toBe(202);
    await expect(runDisconnectJob(id)).rejects.toBeInstanceOf(TransientError);
    const [row] = await connectionById(id);
    expect(row?.status).toBe('disconnecting');
  });

  it('a sibling connection on the same account keeps its token', async () => {
    const shared = `dc-shared-${seq}`;
    const mine = await fakeConnection(alice.userId, shared);
    const theirs = await fakeConnection(bob.userId, shared);
    const [before] = await connectionById(theirs.id);
    expect((await del(mine.id, alice.token)).status).toBe(202);
    expect(await runDisconnectJob(mine.id)).toEqual({
      found: true,
      remote: 'cleaned',
      revoke: 'skipped_sibling',
    });
    const [after] = await connectionById(theirs.id);
    expect(after?.credentialsEncrypted).toBe(before?.credentialsEncrypted);
    const creds = decryptCalendarCredentials(after?.credentialsEncrypted ?? '');
    const token = creds.kind === 'oauth' ? creds.refreshToken : 'none';
    expect(fake.revoked).not.toContain(token);
  });
});
