/**
 * ROK-1596 A3: `reconcileCalendarCopy` against Postgres + the Fake provider
 * (epic ROK-669 §5 tests 5, 6, 8; plan D1/D4/D5, F5, Q4). The connection is
 * a `demo-fake:` row, routed to the Fake by the registry's DEMO_MODE double
 * gate — the pattern of `calendar-disconnect.integration.spec.ts`.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
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
import { utcIsoText } from '../drizzle/timestamp-utils';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from './providers/calendar-provider.errors';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import { deriveInstanceId, parseCopyId } from './providers/rl-copy-id.helpers';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import type { CalendarWriteJobData } from './write/calendar-write.enqueue.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { reconcileCalendarCopy } from './write/calendar-write-reconcile.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const HOUR = 3600_000;

let testApp: TestApp;
let adminToken: string;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let userId: number;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  // The Fake is an app singleton: start each test with an empty store.
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  ({ userId } = await createMemberAndLogin(
    testApp,
    `cal-wr-${seq}`,
    `cal-wr-${seq}@example.test`,
  ));
});

afterEach(async () => {
  dropScriptedFailures();
  jest.restoreAllMocks();
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

function dropScriptedFailures(): void {
  for (;;) {
    try {
      fake.store.takeFailure();
      return;
    } catch {
      // a scripted failure the test did not consume — drop it
    }
  }
}

async function seedConnection(
  overrides: Partial<typeof schema.calendarConnections.$inferInsert> = {},
): Promise<number> {
  const result = fake.seedConnection({ id: `wr-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(schema.calendarConnections)
    .set({ writeEnabled: true, ...overrides })
    .where(eq(schema.calendarConnections.id, id));
  return id;
}

async function eventWithSignup(status = 'signed_up'): Promise<number> {
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

/** One synced copy: a write connection + a signed-up event, reconciled. */
async function setup(status = 'signed_up') {
  const connectionId = await seedConnection();
  const eventId = await eventWithSignup(status);
  const key = { connectionId, eventId, userId };
  return { key, eventId, connectionId };
}

type Key = { connectionId: number; eventId: number; userId: number };

function reconcile(key: Key) {
  const deps = testApp.app.get(CalendarWriteProcessor).reconcileDeps();
  return reconcileCalendarCopy(deps, key);
}

async function linkOf(key: Key) {
  const t = schema.calendarEventLinks;
  const [row] = await testApp.db
    .select()
    .from(t)
    .where(
      and(
        eq(t.connectionId, key.connectionId),
        eq(t.eventId, key.eventId),
        eq(t.userId, key.userId),
      ),
    );
  return row ?? null;
}

async function connectionOf(id: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.id, id));
  if (!row) throw new Error(`connection ${id} missing`);
  return row;
}

const copiesOf = (eventId: number) =>
  fake.store
    .allCopies()
    .filter((c) => c.copyId.endsWith(`:${eventId}:${userId}`));

function setSignupStatus(eventId: number, status: string) {
  return testApp.db
    .update(schema.eventSignups)
    .set({ status })
    .where(eq(schema.eventSignups.eventId, eventId));
}

function setEvent(
  eventId: number,
  fields: Partial<typeof schema.events.$inferInsert>,
) {
  return testApp.db
    .update(schema.events)
    .set(fields)
    .where(eq(schema.events.id, eventId));
}

describe('reconcileCalendarCopy — create (D4)', () => {
  it('creates one copy in the dedicated calendar and a synced link', async () => {
    const { key, eventId, connectionId } = await setup();
    expect(await reconcile(key)).toEqual({ result: 'created' });

    const conn = await connectionOf(connectionId);
    const calId = conn.dedicatedCalendarId;
    expect(calId).not.toBeNull();
    expect(fake.store.calendarName(calId ?? '')).toBe('Raid Ledger');
    const copies = copiesOf(eventId);
    expect(copies).toHaveLength(1);
    const [copy] = nonEmpty(copies, 'copy');
    expect(copy).toMatchObject({
      calendarId: calId,
      title: 'Raid Night',
      busy: true,
    });
    const link = await linkOf(key);
    expect(link).toMatchObject({
      calendarId: calId,
      providerEventId: copy.id,
      etag: copy.etag,
      state: 'synced',
    });
  });

  it('stamps the copy id, event link and bounds — no member names (D4)', async () => {
    const { key, eventId } = await setup();
    await reconcile(key);
    const [copy] = nonEmpty(copiesOf(eventId), 'copy');
    const clientUrl = await settings.getClientUrl();
    const url = `${clientUrl.replace(/\/+$/, '')}/events/${eventId}`;
    const instanceId = deriveInstanceId(new URL(clientUrl).host);
    expect(parseCopyId(copy.copyId, instanceId)).toEqual({ eventId, userId });
    expect(copy.url).toBe(url);
    expect(copy.description).toBe(`${url}\n\nAdded by Raid Ledger`);
    expect(copy.description).not.toContain(`cal-wr-${seq}`);
    const [bounds] = nonEmpty(
      await testApp.db
        .select({
          start: utcIsoText(sql`lower(${schema.events.duration})`),
          end: utcIsoText(sql`upper(${schema.events.duration})`),
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId)),
      'event bounds',
    );
    expect(copy.start.toISOString()).toBe(bounds.start);
    expect(copy.end.toISOString()).toBe(bounds.end);
  });
});

describe('reconcileCalendarCopy — update (§5 test 5, D5)', () => {
  it('§5 test 5: a reschedule updates the same provider event — one copy', async () => {
    const { key, eventId } = await setup();
    await reconcile(key);
    const before = await linkOf(key);
    const start = new Date(Date.now() + 72 * HOUR);
    const end = new Date(start.getTime() + 2 * HOUR);
    await setEvent(eventId, {
      duration: [start, end] as [Date, Date],
      title: 'Moved Raid',
    });

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    const copies = copiesOf(eventId);
    expect(copies).toHaveLength(1);
    const [copy] = nonEmpty(copies, 'copy');
    expect(copy.id).toBe(before?.providerEventId);
    expect(copy.title).toBe('Moved Raid');
    expect(copy.start.toISOString()).toBe(start.toISOString());
    expect((await linkOf(key))?.providerEventId).toBe(before?.providerEventId);
  });

  it('D5: a target flip deletes the old copy and creates one in primary', async () => {
    const { key, eventId, connectionId } = await setup();
    await reconcile(key);
    const dedicated = (await connectionOf(connectionId)).dedicatedCalendarId;
    await testApp.db
      .update(schema.calendarConnections)
      .set({ writeTarget: 'primary' })
      .where(eq(schema.calendarConnections.id, connectionId));

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    expect(fake.store.copiesIn(dedicated ?? '')).toHaveLength(0);
    const copies = copiesOf(eventId);
    expect(copies.map((c) => c.calendarId)).toEqual(['primary']);
    expect((await linkOf(key))?.calendarId).toBe('primary');
  });
});

describe('reconcileCalendarCopy — tentative (§5 test 8)', () => {
  it('tentative → "(Tentative) " + Free; signed_up → same id, Busy; declined → deleted', async () => {
    const { key, eventId } = await setup('tentative');
    expect(await reconcile(key)).toEqual({ result: 'created' });
    const [tentative] = nonEmpty(copiesOf(eventId), 'copy');
    expect(tentative).toMatchObject({
      title: '(Tentative) Raid Night',
      busy: false,
    });

    await setSignupStatus(eventId, 'signed_up');
    expect(await reconcile(key)).toEqual({ result: 'updated' });
    const copies = copiesOf(eventId);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      id: tentative.id,
      title: 'Raid Night',
      busy: true,
    });

    await setSignupStatus(eventId, 'declined');
    expect(await reconcile(key)).toEqual({ result: 'deleted' });
    expect(copiesOf(eventId)).toHaveLength(0);
    expect(await linkOf(key)).toBeNull();
  });
});

describe('reconcileCalendarCopy — removal (§5 test 6)', () => {
  const removals: [string, (eventId: number) => Promise<unknown>][] = [
    ['signup cancelled', (id) => setSignupStatus(id, 'declined')],
    [
      'roster removal (signup row gone)',
      (id) =>
        testApp.db
          .delete(schema.eventSignups)
          .where(eq(schema.eventSignups.eventId, id)),
    ],
    ['event cancelled', (id) => setEvent(id, { cancelledAt: new Date() })],
    [
      'event deleted (row gone)',
      (id) => testApp.db.delete(schema.events).where(eq(schema.events.id, id)),
    ],
  ];

  it.each(removals)(
    '%s → 0 copies, link gone, re-run still 0',
    async (_label, remove) => {
      const { key, eventId } = await setup();
      await reconcile(key);
      expect(copiesOf(eventId)).toHaveLength(1);
      await remove(eventId);

      expect(await reconcile(key)).toEqual({ result: 'deleted' });
      expect(copiesOf(eventId)).toHaveLength(0);
      expect(await linkOf(key)).toBeNull();
      expect((await reconcile(key)).result).toBe('noop');
      expect(copiesOf(eventId)).toHaveLength(0);
    },
  );
});

describe('reconcileCalendarCopy — frozen (F5, Q4, kill switch)', () => {
  it('F5: an ended event keeps its copy and link untouched', async () => {
    const { key, eventId } = await setup();
    await reconcile(key);
    const start = new Date(Date.now() - 5 * HOUR);
    await setEvent(eventId, {
      duration: [start, new Date(start.getTime() + 2 * HOUR)] as [Date, Date],
      title: 'Renamed After End',
    });

    expect(await reconcile(key)).toEqual({
      result: 'noop',
      reason: 'event_ended',
    });
    expect(copiesOf(eventId).map((c) => c.title)).toEqual(['Raid Night']);
    expect((await linkOf(key))?.state).toBe('synced');
  });

  it('Q4: a suppressed link is never touched, even after the signup is cancelled', async () => {
    const { key, eventId } = await setup();
    await reconcile(key);
    await testApp.db
      .update(schema.calendarEventLinks)
      .set({ state: 'suppressed' })
      .where(eq(schema.calendarEventLinks.eventId, eventId));
    await setSignupStatus(eventId, 'declined');

    expect(await reconcile(key)).toEqual({
      result: 'noop',
      reason: 'suppressed',
    });
    expect(copiesOf(eventId)).toHaveLength(1);
    expect((await linkOf(key))?.state).toBe('suppressed');
  });

  it('kill switch off → noop, nothing written', async () => {
    const { key, eventId } = await setup();
    await setCalendarSyncEnabled(settings, false);
    expect(await reconcile(key)).toEqual({
      result: 'noop',
      reason: 'kill_switch_off',
    });
    expect(copiesOf(eventId)).toHaveLength(0);
    expect(await linkOf(key)).toBeNull();
  });
});

describe('reconcileCalendarCopy — healing (§4.5.2.6)', () => {
  it('a copy deleted remotely (NotFound on update) is recreated', async () => {
    const { key, eventId } = await setup();
    await reconcile(key);
    const old = (await linkOf(key))?.providerEventId ?? '';
    fake.store.deleteCopy(old);
    await setEvent(eventId, { title: 'Healed' });

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    const copies = copiesOf(eventId);
    expect(copies.map((c) => c.title)).toEqual(['Healed']);
    expect(copies[0]?.id).not.toBe(old);
    expect((await linkOf(key))?.providerEventId).toBe(copies[0]?.id);
  });

  it('the dedicated calendar deleted remotely is recreated once and persisted', async () => {
    const { key, eventId, connectionId } = await setup();
    await reconcile(key);
    const oldCal = (await connectionOf(connectionId)).dedicatedCalendarId ?? '';
    fake.store.removeCalendar(oldCal);
    const ensure = jest.spyOn(fake, 'ensureRaidLedgerCalendar');

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    expect(ensure).toHaveBeenCalledTimes(1);
    const newCal = (await connectionOf(connectionId)).dedicatedCalendarId;
    expect(newCal).not.toBe(oldCal);
    expect(copiesOf(eventId).map((c) => c.calendarId)).toEqual([newCal]);
    expect((await linkOf(key))?.calendarId).toBe(newCal);
  });

  it('a calendar gone between ensure and write → ensure(null) once, then create', async () => {
    const { key, eventId, connectionId } = await setup();
    await reconcile(key);
    const oldCal = (await connectionOf(connectionId)).dedicatedCalendarId ?? '';
    fake.store.removeCalendar(oldCal);
    // A stale ensure (the calendar vanished right after the lookup).
    const ensure = jest
      .spyOn(fake, 'ensureRaidLedgerCalendar')
      .mockResolvedValueOnce(oldCal);

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    expect(ensure.mock.calls.map((c) => c[1])).toEqual([oldCal, null]);
    const newCal = (await connectionOf(connectionId)).dedicatedCalendarId;
    expect(newCal).not.toBe(oldCal);
    expect(copiesOf(eventId).map((c) => c.calendarId)).toEqual([newCal]);
  });
});

describe('reconcileCalendarCopy — provider errors', () => {
  it('ProviderAuthError → connection needs_reconnect, link failed, no rethrow', async () => {
    const { key, eventId, connectionId } = await setup();
    await reconcile(key);
    await setEvent(eventId, { title: 'Never Written' });
    fake.store.failNext(new ProviderAuthError('invalid_grant'));

    expect(await reconcile(key)).toEqual({
      result: 'failed',
      reason: 'auth:invalid_grant',
    });
    const conn = await connectionOf(connectionId);
    expect(conn).toMatchObject({
      status: 'needs_reconnect',
      lastErrorCode: 'auth:invalid_grant',
    });
    expect(await linkOf(key)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'auth:invalid_grant',
    });
    expect(copiesOf(eventId).map((c) => c.title)).toEqual(['Raid Night']);
  });

  it('ProviderRequestError (permanent 4xx) → link failed, no rethrow; a later run heals it', async () => {
    const { key, eventId, connectionId } = await setup();
    await reconcile(key);
    await setEvent(eventId, { title: 'Second Try' });
    fake.store.failNext(new ProviderRequestError('http_400'));

    expect(await reconcile(key)).toEqual({
      result: 'failed',
      reason: 'rejected:http_400',
    });
    expect((await linkOf(key))?.state).toBe('failed');
    expect((await connectionOf(connectionId)).status).toBe('active');

    expect(await reconcile(key)).toEqual({ result: 'updated' });
    expect(await linkOf(key)).toMatchObject({
      state: 'synced',
      lastErrorCode: null,
    });
    expect(copiesOf(eventId).map((c) => c.title)).toEqual(['Second Try']);
  });

  it.each([
    ['TransientError', () => new TransientError('http_503')],
    ['RateLimitError', () => new RateLimitError(30_000, 'http_429')],
  ])(
    '%s is rethrown for a BullMQ retry; link stays synced',
    async (_n, make) => {
      const { key, eventId, connectionId } = await setup();
      await reconcile(key);
      await setEvent(eventId, { title: 'Retry Me' });
      const err = make();
      fake.store.failNext(err);

      await expect(reconcile(key)).rejects.toBe(err);
      expect((await linkOf(key))?.state).toBe('synced');
      expect((await connectionOf(connectionId)).status).toBe('active');
    },
  );
});

describe('CalendarWriteProcessor', () => {
  it('process(reconcile job) runs the reconcile and returns its outcome', async () => {
    const { key, eventId } = await setup();
    const processor = testApp.app.get(CalendarWriteProcessor);
    const job = {
      data: { kind: 'reconcile', ...key },
    } as Job<CalendarWriteJobData>;

    expect(await processor.process(job)).toEqual({ result: 'created' });
    expect(copiesOf(eventId)).toHaveLength(1);
  });
});

/** Undo's placeholder (`undoEventCalendarCopy`) landing mid-reconcile. */
function undoMidFlight(key: Key, after: (ref: unknown) => unknown) {
  const real = fake.upsertEvent.bind(fake);
  return jest.spyOn(fake, 'upsertEvent').mockImplementation(async (...args) => {
    const ref = await real(...args);
    await testApp.db
      .insert(schema.calendarEventLinks)
      .values({
        ...key,
        calendarId: '',
        providerEventId: '',
        state: 'suppressed',
      })
      .onConflictDoNothing();
    return after(ref) as typeof ref;
  });
}

describe('reconcileCalendarCopy — races (review B1, M2)', () => {
  it('B1: concurrent reconciles of one connection end with ONE dedicated calendar holding both copies', async () => {
    const connectionId = await seedConnection();
    const e1 = await eventWithSignup();
    const e2 = await eventWithSignup();
    const real = fake.ensureRaidLedgerCalendar.bind(fake);
    const created: string[] = [];
    let release = (): void => undefined;
    const bothCreated = new Promise<void>((r) => (release = r));
    // Hold each run after its ensure until both have created a calendar.
    jest
      .spyOn(fake, 'ensureRaidLedgerCalendar')
      .mockImplementation(async (creds, known) => {
        const id = await real(creds, known);
        created.push(id);
        if (created.length === 2) release();
        await bothCreated;
        return id;
      });

    const results = await Promise.all(
      [e1, e2].map((eventId) => reconcile({ connectionId, eventId, userId })),
    );
    expect(results).toEqual([{ result: 'created' }, { result: 'created' }]);
    expect(new Set(created).size).toBe(2);
    const winner = (await connectionOf(connectionId)).dedicatedCalendarId;
    const live = created.filter((id) => fake.store.hasCalendar(id));
    expect(live).toEqual([winner]);
    const copies = [...copiesOf(e1), ...copiesOf(e2)];
    expect(copies.map((c) => c.calendarId)).toEqual([winner, winner]);
    for (const eventId of [e1, e2])
      expect(
        (await linkOf({ connectionId, eventId, userId }))?.calendarId,
      ).toBe(winner);
  });

  it('M2: Undo between create and saveLink wins — link stays suppressed, no copy remains', async () => {
    const { key, eventId } = await setup();
    undoMidFlight(key, (ref) => ref);

    expect(await reconcile(key)).toEqual({
      result: 'noop',
      reason: 'suppressed',
    });
    expect((await linkOf(key))?.state).toBe('suppressed');
    expect(copiesOf(eventId)).toHaveLength(0);
  });

  it('M2: a terminal failure after a mid-flight Undo leaves the link suppressed', async () => {
    const { key } = await setup();
    undoMidFlight(key, () => {
      throw new ProviderRequestError('http_400');
    });

    expect((await reconcile(key)).result).toBe('failed');
    expect(await linkOf(key)).toMatchObject({
      state: 'suppressed',
      lastErrorCode: null,
    });
  });
});

describe('reconcileCalendarCopy — failures leave a trace (review m4)', () => {
  it('a permanent 4xx on create (no link yet) records a failed link; a later run heals it', async () => {
    const { key, eventId } = await setup();
    fake.store.failNext(new ProviderRequestError('http_400'));

    expect(await reconcile(key)).toEqual({
      result: 'failed',
      reason: 'rejected:http_400',
    });
    expect(await linkOf(key)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'rejected:http_400',
      providerEventId: '',
    });

    const del = jest.spyOn(fake, 'deleteEvent');
    expect((await reconcile(key)).result).toBe('updated');
    expect(del).not.toHaveBeenCalled();
    const [copy] = nonEmpty(copiesOf(eventId), 'copy');
    expect(await linkOf(key)).toMatchObject({
      state: 'synced',
      providerEventId: copy.id,
      lastErrorCode: null,
    });
  });

  it('a transient error on the FINAL attempt records a failed link and still rethrows', async () => {
    const { key } = await setup();
    const deps = testApp.app.get(CalendarWriteProcessor).reconcileDeps();
    const err = new TransientError('http_503');
    fake.store.failNext(err);

    await expect(
      reconcileCalendarCopy(deps, key, { finalAttempt: true }),
    ).rejects.toBe(err);
    expect(await linkOf(key)).toMatchObject({
      state: 'failed',
      lastErrorCode: 'transient:http_503',
    });
  });

  it('a transient error before the final attempt records nothing (BullMQ retries)', async () => {
    const { key } = await setup();
    const err = new TransientError('http_503');
    fake.store.failNext(err);

    await expect(reconcile(key)).rejects.toBe(err);
    expect(await linkOf(key)).toBeNull();
  });
});
