/**
 * ROK-1592: `DELETE /users/me/calendars/:id` + the DEMO_MODE seed endpoint
 * against Postgres (plan L9/L15, ruling Q-E). Google revoke is a
 * `googleHttp.googleFormPost` spy.
 */
import { eq } from 'drizzle-orm';
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
  GOOGLE_CALENDAR_APP_CREATED_SCOPE,
  GOOGLE_REVOKE_URL,
} from './providers/google/google-oauth.helpers';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
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
let adminToken: string;
let alice: { userId: number; token: string };
let bob: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  // The Fake is registered only when the app BOOTS with DEMO_MODE=true (L15).
  process.env.DEMO_MODE = 'true';
  try {
    testApp = await getTestApp();
  } finally {
    restoreDemoMode();
  }
});

beforeEach(async () => {
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
    await insertLink(row.id, alice.userId);
    expect(await linksOf(row.id)).toHaveLength(1);
    expect((await del(row.id, alice.token)).status).toBe(202);
    expect(await connectionById(row.id)).toHaveLength(0);
    expect(await linksOf(row.id)).toHaveLength(0);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: 'refresh-alice' },
    ]);
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
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toHaveLength(1);
    expect(await connectionById(row.id)).toHaveLength(0);
  });

  it('skips the revoke while another user holds the same Google account (Q-D)', async () => {
    const spy = googleSpy();
    const shared = `sub-shared-${seq}`;
    const mine = await insertConnection(alice.userId, shared, 'refresh-shared');
    const theirs = await insertConnection(bob.userId, shared, 'refresh-shared');
    expect((await del(mine.id, alice.token)).status).toBe(202);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toHaveLength(0);
    expect(await connectionById(mine.id)).toHaveLength(0);
    expect(await connectionById(theirs.id)).toHaveLength(1);
  });

  it('still works with the kill switch OFF (ruling Q-E)', async () => {
    await setCalendarSyncEnabled(testApp.app.get(SettingsService), false);
    const row = await insertConnection(
      alice.userId,
      `sub-alice-${seq}`,
      'refresh-alice',
    );
    expect((await del(row.id, alice.token)).status).toBe(202);
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
    expect(spy).not.toHaveBeenCalled();
    const fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
    expect(fake).toBeInstanceOf(FakeCalendarProvider);
    expect(fake.revoked).toContain(
      creds.kind === 'oauth' ? creds.refreshToken : 'not-oauth',
    );
    expect(await connectionById(id)).toHaveLength(0);
  });
});
