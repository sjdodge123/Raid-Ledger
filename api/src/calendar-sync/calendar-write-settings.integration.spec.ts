/**
 * ROK-1596 A5: `PATCH /users/me/calendars/:id` (D6) + the `write-off` job
 * against Postgres + the Fake provider (`demo-fake:` rows, DEMO_MODE double
 * gate). The worker is paused so queued jobs are run explicitly through
 * `CalendarWriteProcessor.process` — deterministic, no 5 s debounce.
 */
import { eq, sql } from 'drizzle-orm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_WRITE_QUEUE,
  reconcileJobId,
  writeOffJobId,
} from './calendar-sync.constants';
import { GOOGLE_EVENTS_SCOPE } from './providers/google/google-oauth.helpers';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import { FAKE_PRIMARY_CALENDAR_ID } from './providers/testing/fake-calendar-store';
import {
  FAKE_DEFAULT_SCOPES,
  type FakeCalendarProvider,
} from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import { CALENDAR_WRITE_LOCK_CLASS } from './services/calendar-write-settings.helpers';
import type { CalendarWriteJobData } from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const WITH_EVENTS = [...FAKE_DEFAULT_SCOPES, GOOGLE_EVENTS_SCOPE];
const conns = schema.calendarConnections;
const links = schema.calendarEventLinks;

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let processor: CalendarWriteProcessor;
let queue: Queue;
let user: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  processor = testApp.app.get(CalendarWriteProcessor);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  await processor.worker.pause(true);
});

afterAll(() => processor.worker.resume());

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  await queue.drain(true); // ids repeat across truncations
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  user = await createMemberAndLogin(
    testApp,
    `cal-ws-${seq}`,
    `cal-ws-${seq}@example.test`,
  );
});

afterEach(async () => {
  await queue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedConnection(
  opts: { suffix?: string; scopes?: string[]; writeEnabled?: boolean } = {},
): Promise<number> {
  const result = fake.seedConnection({
    id: `ws-${seq}${opts.suffix ?? ''}`,
    scopes: opts.scopes ?? [...FAKE_DEFAULT_SCOPES],
  });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId: user.userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(conns)
    .set({ writeEnabled: opts.writeEnabled ?? false })
    .where(eq(conns.id, id));
  return id;
}

async function eventWithSignup(status = 'signed_up'): Promise<number> {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: `Raid ${status}`,
  });
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: user.userId,
    status,
    confirmationStatus: 'pending',
  });
  return eventId;
}

function patch(id: number, body: unknown, token = user.token) {
  return testApp.request
    .patch(`/users/me/calendars/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);
}

async function rowOf(id: number) {
  const [row] = await testApp.db.select().from(conns).where(eq(conns.id, id));
  return row;
}

/** Run one queued job through the processor; returns its outcome. */
async function runJob(jobId: string): Promise<unknown> {
  const job = (await queue.getJob(jobId)) as Job<CalendarWriteJobData>;
  expect(job?.id).toBe(jobId);
  const outcome = await processor.process(job);
  await queue.remove(jobId);
  return outcome;
}

async function runReconciles(connectionId: number, eventIds: number[]) {
  for (const eventId of eventIds) {
    await runJob(reconcileJobId(connectionId, eventId, user.userId));
  }
}

const calendarsInUse = () =>
  [...new Set(fake.store.allCopies().map((c) => c.calendarId))].sort();

describe('PATCH /users/me/calendars/:id — validation (D6)', () => {
  it("another user's connection id → 404, row untouched", async () => {
    const id = await seedConnection();
    const other = await createMemberAndLogin(
      testApp,
      `cal-ws-o-${seq}`,
      `cal-ws-o-${seq}@example.test`,
    );
    const res = await patch(id, { write: { enabled: true } }, other.token);
    expect(res.status).toBe(404);
    expect((await rowOf(id))?.writeEnabled).toBe(false);
  });

  it('a `read` key → 400 read_not_available, nothing persisted', async () => {
    const id = await seedConnection();
    const res = await patch(id, {
      read: { enabled: true },
      write: { enabled: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('read_not_available');
    expect((await rowOf(id))?.writeEnabled).toBe(false);
  });

  it('kill switch off → 404 (guard)', async () => {
    const id = await seedConnection();
    await setCalendarSyncEnabled(settings, false);
    expect((await patch(id, { write: { enabled: true } })).status).toBe(404);
  });

  it('a second write connection → 409 write_already_enabled (F6)', async () => {
    await seedConnection({ suffix: '-a', writeEnabled: true });
    const second = await seedConnection({ suffix: '-b' });
    const res = await patch(second, { write: { enabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('write_already_enabled');
    expect((await rowOf(second))?.writeEnabled).toBe(false);
  });

  it('primary without calendar.events → 409 needs_consent, nothing persisted or queued', async () => {
    const id = await seedConnection();
    const eventId = await eventWithSignup();
    const res = await patch(id, {
      write: { enabled: true, target: 'primary' },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('needs_consent');
    const row = await rowOf(id);
    expect([row?.writeEnabled, row?.writeTarget]).toEqual([false, 'dedicated']);
    const jobId = reconcileJobId(id, eventId, user.userId);
    expect(await queue.getJob(jobId)).toBeUndefined();
  });
});

describe('PATCH write settings — queued remote work', () => {
  it('enable → a reconcile per active sign-up → copies on the dedicated calendar', async () => {
    const id = await seedConnection();
    const active = [
      await eventWithSignup(),
      await eventWithSignup('tentative'),
    ];
    const declined = await eventWithSignup('declined');
    expect((await patch(id, { write: { enabled: true } })).status).toBe(204);
    expect((await rowOf(id))?.writeEnabled).toBe(true);
    const skipped = reconcileJobId(id, declined, user.userId);
    expect(await queue.getJob(skipped)).toBeUndefined();
    await runReconciles(id, active);
    const dedicated = (await rowOf(id))?.dedicatedCalendarId;
    expect(dedicated).toEqual(expect.any(String));
    expect(fake.store.copiesIn(dedicated as string)).toHaveLength(2);
    expect(calendarsInUse()).toEqual([dedicated]);
  });

  it('target flip dedicated → primary → back moves every copy, no orphans (F9 keeps the calendar)', async () => {
    const id = await seedConnection({ scopes: WITH_EVENTS });
    const events = [await eventWithSignup(), await eventWithSignup()];
    await patch(id, { write: { enabled: true } });
    await runReconciles(id, events);
    const dedicated = (await rowOf(id))?.dedicatedCalendarId as string;

    expect((await patch(id, { write: { target: 'primary' } })).status).toBe(
      204,
    );
    expect((await rowOf(id))?.writeTarget).toBe('primary');
    await runReconciles(id, events);
    expect(calendarsInUse()).toEqual([FAKE_PRIMARY_CALENDAR_ID]);
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toHaveLength(2);
    expect(fake.store.hasCalendar(dedicated)).toBe(true);

    await patch(id, { write: { target: 'dedicated' } });
    await runReconciles(id, events);
    expect(calendarsInUse()).toEqual([dedicated]);
    expect(fake.store.copiesIn(dedicated)).toHaveLength(2);
  });
});

describe('PATCH write off — the write-off job (Q5, F8)', () => {
  it('write off → write-off job deletes copies + the dedicated calendar, clears links incl. suppressed (Q5, F8)', async () => {
    const id = await seedConnection({ scopes: WITH_EVENTS });
    const [kept, undone] = [await eventWithSignup(), await eventWithSignup()];
    await patch(id, { write: { enabled: true } });
    await runReconciles(id, [kept]);
    const dedicated = (await rowOf(id))?.dedicatedCalendarId as string;
    await patch(id, { write: { target: 'primary' } });
    await runReconciles(id, [kept]);
    await testApp.db.insert(links).values({
      connectionId: id,
      userId: user.userId,
      eventId: undone,
      calendarId: FAKE_PRIMARY_CALENDAR_ID,
      providerEventId: 'undone-by-user',
      state: 'suppressed',
    });
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toHaveLength(1);

    expect((await patch(id, { write: { enabled: false } })).status).toBe(204);
    expect(await runJob(writeOffJobId(id))).toEqual({
      result: 'done',
      deletedCopies: 1,
    });
    expect(fake.store.allCopies()).toEqual([]);
    expect(fake.store.hasCalendar(dedicated)).toBe(false);
    const row = await rowOf(id);
    expect([row?.writeEnabled, row?.dedicatedCalendarId]).toEqual([
      false,
      null,
    ]);
    const left = await testApp.db
      .select()
      .from(links)
      .where(eq(links.connectionId, id));
    expect(left).toEqual([]);
  });

  it('write-off is skipped when sending is back on by the time it runs', async () => {
    const id = await seedConnection();
    const eventId = await eventWithSignup();
    await patch(id, { write: { enabled: true } });
    await runReconciles(id, [eventId]);
    await patch(id, { write: { enabled: false } });
    await testApp.db
      .update(conns)
      .set({ writeEnabled: true })
      .where(eq(conns.id, id));
    expect(await runJob(writeOffJobId(id))).toEqual({
      result: 'noop',
      reason: 'write_enabled',
    });
    expect(fake.store.allCopies()).toHaveLength(1);
  });
});

describe('PATCH write settings — review fixes (m1, m2)', () => {
  it('two concurrent enables on two connections → exactly one 204, one 409 (advisory lock)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const a = await seedConnection({ suffix: `-ra${round}` });
      const b = await seedConnection({ suffix: `-rb${round}` });
      const statuses = (
        await Promise.all([
          patch(a, { write: { enabled: true } }),
          patch(b, { write: { enabled: true } }),
        ])
      ).map((r) => r.status);
      expect(statuses.sort()).toEqual([204, 409]);
      const writers = await testApp.db
        .select({ id: conns.id })
        .from(conns)
        .where(eq(conns.writeEnabled, true));
      expect(writers).toHaveLength(1);
      await testApp.db.delete(conns).where(eq(conns.userId, user.userId));
    }
  });

  it('enable on a row already targeting primary but missing calendar.events → 409 needs_consent', async () => {
    const id = await seedConnection();
    await testApp.db
      .update(conns)
      .set({ writeTarget: 'primary' })
      .where(eq(conns.id, id));
    const res = await patch(id, { write: { enabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('needs_consent');
    expect((await rowOf(id))?.writeEnabled).toBe(false);
  });
});

describe('PATCH write settings — final review (row read inside the lock)', () => {
  it('a target-only PATCH queued behind a disable keeps write OFF (row read inside the lock)', async () => {
    const id = await seedConnection({
      scopes: WITH_EVENTS,
      writeEnabled: true,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const lockHeld = new Promise<void>((r) => (held = r));
    // Stands in for the disable PATCH: holds the per-user lock, then commits.
    const disable = testApp.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CALENDAR_WRITE_LOCK_CLASS}::int4, ${user.userId}::int4)`,
      );
      held();
      await gate;
      await tx
        .update(conns)
        .set({ writeEnabled: false })
        .where(eq(conns.id, id));
    });
    await lockHeld;
    const targetOnly = patch(id, { write: { target: 'primary' } }).then(
      (r) => r,
    );
    await waitFor(
      async () => {
        const waiting = await testApp.db.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = ${CALENDAR_WRITE_LOCK_CLASS} AND objid = ${user.userId} AND objsubid = 2`,
        );
        expect(waiting[0]?.n).toBe(1);
      },
      5000,
      20,
    );
    release();
    await disable;
    expect((await targetOnly).status).toBe(204);
    const row = await rowOf(id);
    expect({
      writeEnabled: row?.writeEnabled,
      target: row?.writeTarget,
    }).toEqual({
      writeEnabled: false,
      target: 'primary',
    });
  });
});
