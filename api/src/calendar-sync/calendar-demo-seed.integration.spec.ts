/**
 * ROK-1596 W3: the DEMO_MODE seeds the smoke spec + UI test plan use —
 * `seed-connection {writeEnabled, writeTarget}` and the new
 * `POST /admin/test/calendar/seed-link` — against Postgres and the Fake.
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
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const SEED_CONN = '/admin/test/calendar/seed-connection';
const SEED_LINK = '/admin/test/calendar/seed-link';

let testApp: TestApp;
let fake: FakeCalendarProvider;
let adminToken: string;
let member: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
});

beforeEach(async () => {
  seq += 1;
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  member = await createMemberAndLogin(
    testApp,
    `cal-seed-${seq}`,
    `cal-seed-${seq}@example.test`,
  );
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
});

afterEach(async () => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  await testApp.app.get(SettingsService).setDemoMode(false);
  testApp.seed = await truncateAllTables(testApp.db);
});

async function demoKeys(env: boolean, setting: boolean): Promise<void> {
  if (env) process.env.DEMO_MODE = 'true';
  else delete process.env.DEMO_MODE;
  await testApp.app.get(SettingsService).setDemoMode(setting);
}

function post(path: string, body: object, token = adminToken) {
  return testApp.request
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function connectionById(id: number) {
  const t = schema.calendarConnections;
  return testApp.db.select().from(t).where(eq(t.id, id));
}

describe('POST /admin/test/calendar/seed-link — gates', () => {
  const body = () => ({ userId: member.userId, eventId: 1, state: 'synced' });

  it('403s when env DEMO_MODE is off, even with the setting on', async () => {
    await demoKeys(false, true);
    expect((await post(SEED_LINK, body())).status).toBe(403);
  });

  it('403s when the demo_mode setting is off', async () => {
    await demoKeys(true, false);
    expect((await post(SEED_LINK, body())).status).toBe(403);
  });

  it('403s for a non-admin', async () => {
    await demoKeys(true, true);
    expect((await post(SEED_LINK, body(), member.token)).status).toBe(403);
  });

  it('404s when the user has no demo-fake connection', async () => {
    await demoKeys(true, true);
    expect((await post(SEED_LINK, body())).status).toBe(404);
  });
});

describe('POST /admin/test/calendar/seed-connection — write fields', () => {
  beforeEach(() => demoKeys(true, true));

  it('seed-connection stores writeEnabled + writeTarget', async () => {
    const res = await post(SEED_CONN, {
      userId: member.userId,
      writeEnabled: true,
      writeTarget: 'primary',
    });
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await connectionById((res.body as { id: number }).id),
      'seeded connection',
    );
    expect(row).toMatchObject({
      userId: member.userId,
      writeEnabled: true,
      writeTarget: 'primary',
    });
  });
});

describe('POST /admin/test/calendar/seed-link — happy paths', () => {
  beforeEach(() => demoKeys(true, true));

  it('seed-link synced → link row + a Fake copy, and the copy endpoint reads it', async () => {
    await setCalendarSyncEnabled(testApp.app.get(SettingsService), true);
    const conn = await post(SEED_CONN, {
      userId: member.userId,
      writeEnabled: true,
    });
    const connId = (conn.body as { id: number }).id;
    const eventId = await createFutureEvent(testApp, adminToken, {
      title: `Seeded raid ${seq}`,
    });
    const res = await post(SEED_LINK, {
      userId: member.userId,
      eventId,
      state: 'synced',
    });
    expect(res.status).toBe(201);
    const t = schema.calendarEventLinks;
    const [link] = nonEmpty(
      await testApp.db
        .select()
        .from(t)
        .where(eq(t.id, (res.body as { linkId: number }).linkId)),
      'seeded link',
    );
    expect(link).toMatchObject({
      connectionId: connId,
      userId: member.userId,
      eventId,
      state: 'synced',
    });
    const [row] = nonEmpty(await connectionById(connId), 'connection');
    expect(row.dedicatedCalendarId).toBe(link.calendarId);
    const copy = fake.store.getCopy(link.providerEventId);
    expect(copy).toMatchObject({
      calendarId: link.calendarId,
      title: `Seeded raid ${seq}`,
      busy: true,
    });
    const got = await testApp.request
      .get(`/users/me/calendars/events/${eventId}`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ provider: 'google', state: 'synced' });
  });

  it('seed-link failed → placeholder ids, no Fake copy; re-seed upserts the same row', async () => {
    await post(SEED_CONN, { userId: member.userId, writeEnabled: true });
    const eventId = await createFutureEvent(testApp, adminToken);
    const first = await post(SEED_LINK, {
      userId: member.userId,
      eventId,
      state: 'failed',
    });
    const again = await post(SEED_LINK, {
      userId: member.userId,
      eventId,
      state: 'suppressed',
    });
    expect(again.body).toEqual(first.body);
    const t = schema.calendarEventLinks;
    const rows = await testApp.db
      .select()
      .from(t)
      .where(eq(t.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'suppressed',
      calendarId: '',
      providerEventId: '',
    });
    expect(fake.store.allCopies()).toHaveLength(0);
  });
});
