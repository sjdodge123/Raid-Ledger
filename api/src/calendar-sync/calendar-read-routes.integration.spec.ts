/**
 * ROK-1593 A8 (§1.4 / §3.6): the read routes against Postgres + the Fake
 * provider (`demo-fake:` rows, DEMO_MODE double gate). The read worker is
 * paused so a queued sync is run explicitly through
 * `CalendarReadProcessor.process` — deterministic.
 */
import { eq } from 'drizzle-orm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { CalendarsOverviewSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import { CALENDAR_READ_QUEUE, readSyncJobId } from './calendar-sync.constants';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import {
  FAKE_DEFAULT_SCOPES,
  type FakeCalendarProvider,
} from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import type { CalendarReadJobData } from './read/calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/users/me/calendars';
const conns = schema.calendarConnections;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let processor: CalendarReadProcessor;
let queue: Queue;
let user: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  processor = testApp.app.get(CalendarReadProcessor);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_READ_QUEUE));
  await processor.worker.pause(true);
});

afterAll(() => processor.worker.resume());

beforeEach(async () => {
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  await queue.drain(true); // ids repeat across truncations
  seq += 1;
  user = await member('me');
});

afterEach(async () => {
  await queue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

function member(tag: string) {
  const name = `cal-rr-${tag}-${seq}`;
  return createMemberAndLogin(testApp, name, `${name}@example.test`);
}

interface SeedOpts {
  owner?: number;
  granted?: boolean;
  readEnabled?: boolean;
  dedicated?: string | null;
  lastSyncedAt?: Date | null;
}

async function seedConnection(opts: SeedOpts = {}): Promise<number> {
  const result = fake.seedConnection({
    id: `rr-${seq}-${opts.owner ?? 'me'}`,
    scopes: [...FAKE_DEFAULT_SCOPES],
  });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId: opts.owner ?? user.userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(conns)
    .set({
      readAccessGranted: opts.granted ?? false,
      readEnabled: opts.readEnabled ?? false,
      dedicatedCalendarId: opts.dedicated ?? null,
      lastSyncedAt: opts.lastSyncedAt ?? null,
    })
    .where(eq(conns.id, id));
  return id;
}

async function rowOf(id: number) {
  const [row] = await testApp.db.select().from(conns).where(eq(conns.id, id));
  return row;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function getCalendars(id: number, token = user.token) {
  return testApp.request.get(`${ROUTE}/${id}/calendars`).set(auth(token));
}

function postSync(id: number, token = user.token) {
  return testApp.request.post(`${ROUTE}/${id}/sync`).set(auth(token));
}

function patch(id: number, body: object, token = user.token) {
  return testApp.request.patch(`${ROUTE}/${id}`).set(auth(token)).send(body);
}

function putSettings(body: object, token = user.token) {
  return testApp.request.put(`${ROUTE}/settings`).set(auth(token)).send(body);
}

async function jobState(id: number): Promise<string | null> {
  const job = await queue.getJob(readSyncJobId(id));
  return job ? job.getState() : null;
}

// ─── ownership + kill switch ─────────────────────────────────────────────────

describe('read routes — ownership and the kill switch', () => {
  it("another user's connection id → 404 on every read route", async () => {
    const other = await member('other');
    const id = await seedConnection({
      owner: other.userId,
      granted: true,
      readEnabled: true,
    });
    expect((await getCalendars(id)).status).toBe(404);
    expect((await postSync(id)).status).toBe(404);
    expect((await patch(id, { read: { enabled: false } })).status).toBe(404);
    expect(await rowOf(id)).toMatchObject({ readEnabled: true });
    expect(await jobState(id)).toBeNull();
  });

  it('kill switch off → 404 on every read route, nothing written', async () => {
    const id = await seedConnection({ granted: true });
    await setCalendarSyncEnabled(settings, false);
    expect((await getCalendars(id)).status).toBe(404);
    expect((await postSync(id)).status).toBe(404);
    expect((await patch(id, { read: { enabled: true } })).status).toBe(404);
    expect((await putSettings({ mode: 'days' })).status).toBe(404);
    expect((await rowOf(id))?.readEnabled).toBe(false);
    const prefs = await testApp.db.select().from(schema.userPreferences);
    expect(prefs.filter((p) => p.key === 'calendar_read_mode')).toEqual([]);
  });
});

// ─── GET :id/calendars ───────────────────────────────────────────────────────

describe('GET /users/me/calendars/:id/calendars', () => {
  it('lists the Fake calendars with the dedicated one flagged isRaidLedger', async () => {
    const dedicated = `rl-${seq}`;
    fake.seedCalendars([
      { id: dedicated, name: 'Raid Ledger' },
      { id: `work-${seq}`, name: 'Work' },
    ]);
    const id = await seedConnection({ granted: true, dedicated });
    const res = await getCalendars(id);
    expect(res.status).toBe(200);
    const flags = Object.fromEntries(
      (res.body as { id: string; isRaidLedger: boolean }[]).map((c) => [
        c.id,
        c.isRaidLedger,
      ]),
    );
    expect(flags).toMatchObject({
      primary: false,
      [dedicated]: true,
      [`work-${seq}`]: false,
    });
  });

  it('a grant without the read scopes → 409 read_scopes', async () => {
    const id = await seedConnection({ granted: false });
    const res = await getCalendars(id);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('read_scopes');
  });
});

// ─── PATCH :id { read } ──────────────────────────────────────────────────────

describe('PATCH /users/me/calendars/:id — read block (replaces 1596 400)', () => {
  it('enable without the read grant → 409 read_scopes, nothing persisted or queued', async () => {
    const id = await seedConnection({ granted: false });
    const res = await patch(id, { read: { enabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('read_scopes');
    expect((await rowOf(id))?.readEnabled).toBe(false);
    expect(await jobState(id)).toBeNull();
  });

  it('strips the dedicated calendar id, turns read on and enqueues one sync', async () => {
    const dedicated = `rl-${seq}`;
    const id = await seedConnection({ granted: true, dedicated });
    const res = await patch(id, {
      read: { enabled: true, calendarIds: ['primary', dedicated, 'work'] },
    });
    expect(res.status).toBe(204);
    const row = await rowOf(id);
    expect(row?.readCalendarIds).toEqual(['primary', 'work']);
    expect(row?.readEnabled).toBe(true);
    expect(await jobState(id)).toBe('waiting');
  });

  it('read off → persisted, no sync queued', async () => {
    const id = await seedConnection({ granted: true, readEnabled: true });
    expect((await patch(id, { read: { enabled: false } })).status).toBe(204);
    expect((await rowOf(id))?.readEnabled).toBe(false);
    expect(await jobState(id)).toBeNull();
  });
});

// ─── POST :id/sync ───────────────────────────────────────────────────────────

describe('POST /users/me/calendars/:id/sync', () => {
  it('twice within 5 minutes → 202 then 429 sync_throttled, one job only', async () => {
    const id = await seedConnection({ granted: true, readEnabled: true });
    expect((await postSync(id)).status).toBe(202);
    const job = (await queue.getJob(
      readSyncJobId(id),
    )) as Job<CalendarReadJobData>;
    expect(job?.id).toBe(readSyncJobId(id));
    expect(await processor.process(job)).toBe('synced');
    await queue.remove(readSyncJobId(id));
    expect((await rowOf(id))?.lastSyncedAt).not.toBeNull();

    const again = await postSync(id);
    expect(again.status).toBe(429);
    expect(again.body.message).toBe('sync_throttled');
    expect(await jobState(id)).toBeNull();
  });

  it('a sync older than 5 minutes is not throttled', async () => {
    const lastSyncedAt = new Date(Date.now() - 6 * 60 * 1000);
    const id = await seedConnection({
      granted: true,
      readEnabled: true,
      lastSyncedAt,
    });
    expect((await postSync(id)).status).toBe(202);
    expect(await jobState(id)).toBe('waiting');
  });

  it('read off → 409 read_disabled, nothing queued', async () => {
    const id = await seedConnection({ granted: true, readEnabled: false });
    const res = await postSync(id);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('read_disabled');
    expect(await jobState(id)).toBeNull();
  });
});

// ─── PUT settings + overview ─────────────────────────────────────────────────

describe('PUT /users/me/calendars/settings + overview', () => {
  it('rejects an unknown mode with 400 invalid_body', async () => {
    const res = await putSettings({ mode: 'weeks' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('invalid_body');
  });

  it('stores the mode; the overview reads it back with readAccess per row', async () => {
    const granted = await seedConnection({ granted: true });
    expect((await putSettings({ mode: 'hours' })).status).toBe(204);
    expect((await putSettings({ mode: 'days' })).status).toBe(204);
    const res = await testApp.request.get(ROUTE).set(auth(user.token));
    expect(res.status).toBe(200);
    expect(res.body.readSettings).toEqual({ mode: 'days', lookAheadWeeks: 4 });
    expect(res.body.connections).toEqual([
      expect.objectContaining({ id: granted, readAccess: 'granted' }),
    ]);
    expect(() => CalendarsOverviewSchema.parse(res.body)).not.toThrow();
  });
});

// ─── POST /admin/test/calendar/seed-busy ─────────────────────────────────────

describe('POST /admin/test/calendar/seed-busy', () => {
  const block = {
    start: '2026-11-02T18:00:00.000Z',
    end: '2026-11-02T20:00:00.000Z',
  };

  async function seedBusy(body: object) {
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    return testApp.request
      .post('/admin/test/calendar/seed-busy')
      .set(auth(token))
      .send(body);
  }

  it('403s when env DEMO_MODE is off (same gate as seed-connection)', async () => {
    const id = await seedConnection();
    delete process.env.DEMO_MODE;
    const res = await seedBusy({ connectionId: id, blocks: [block] });
    expect(res.status).toBe(403);
    const rows = await testApp.db.select().from(schema.calendarBusyBlocks);
    expect(rows).toEqual([]);
  });

  it('inserts the blocks for the owner and flips the read grant', async () => {
    const id = await seedConnection();
    const res = await seedBusy({
      connectionId: id,
      blocks: [block],
      readAccess: 'granted',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ inserted: 1 });
    const rows = await testApp.db.select().from(schema.calendarBusyBlocks);
    expect(rows).toEqual([
      expect.objectContaining({
        connectionId: id,
        userId: user.userId,
        allDay: false,
        startsAt: new Date(block.start),
      }),
    ]);
    expect(await rowOf(id)).toMatchObject({
      readAccessGranted: true,
      readEnabled: true,
    });
  });
});
