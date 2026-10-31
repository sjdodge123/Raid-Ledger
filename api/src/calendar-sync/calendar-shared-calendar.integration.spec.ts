/**
 * ROK-1597 Codex P1: two Raid Ledger users connect the SAME remote account and
 * both adopt one dedicated "Raid Ledger" calendar (Microsoft/Apple adopt by
 * name). Disconnecting or switching off sending for one must delete only its
 * own copies and keep the calendar; the last connection out removes it.
 * Runs the job bodies directly against Postgres with a standalone fake.
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
import * as schema from '../drizzle/schema';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import {
  runCalendarDisconnect,
  type CalendarDisconnectRegistry,
} from './services/calendar-disconnect.helpers';
import { runCalendarWriteOff } from './write/calendar-write-off.helpers';

let testApp: TestApp;
let fake: FakeCalendarProvider;
let adminToken: string;
let seq = 0;

const conns = schema.calendarConnections;

function registry(): CalendarDisconnectRegistry {
  return {
    getAccountProviderForConnection: () => Promise.resolve(fake),
    getWriteProviderForConnection: () => Promise.resolve(fake),
  };
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  fake = new FakeCalendarProvider({ key: 'microsoft' });
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  seq += 1;
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** One user's connection to the shared account, with one copy in `cal`. */
async function connectTo(cal: string, who: string, eventId: number) {
  const user = await createMemberAndLogin(
    testApp,
    `cal-sh-${who}-${seq}`,
    `cal-sh-${who}-${seq}@example.test`,
  );
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId: user.userId,
    provider: 'microsoft',
    result: fake.seedConnection({ id: `shared-${seq}` }),
  });
  await testApp.db
    .update(conns)
    .set({ dedicatedCalendarId: cal, writeEnabled: true })
    .where(eq(conns.id, id));
  const copy = fake.store.upsertCopy(
    cal,
    {
      copyId: `rl-${who}-${eventId}`,
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
    connectionId: id,
    userId: user.userId,
    eventId,
    calendarId: cal,
    providerEventId: copy.id,
  });
  return { id, copyId: copy.id };
}

async function twoConnectionsOneCalendar() {
  const cal = fake.store.createCalendar('Raid Ledger');
  const eventId = await createFutureEvent(testApp, adminToken);
  const alice = await connectTo(cal, 'a', eventId);
  const bob = await connectTo(cal, 'b', eventId);
  return { cal, alice, bob };
}

function disconnect(id: number) {
  return testApp.db
    .update(conns)
    .set({ status: 'disconnecting' })
    .where(eq(conns.id, id))
    .then(() =>
      runCalendarDisconnect({ db: testApp.db, registry: registry() }, id),
    );
}

const copyIdsIn = (cal: string): string[] =>
  fake.store.copiesIn(cal).map((c) => c.id);

describe('a dedicated calendar shared by two connections (Codex P1)', () => {
  it('disconnecting one deletes only its copy and keeps the calendar', async () => {
    const { cal, alice, bob } = await twoConnectionsOneCalendar();
    expect(await disconnect(alice.id)).toMatchObject({ remote: 'cleaned' });
    expect(fake.store.hasCalendar(cal)).toBe(true);
    expect(copyIdsIn(cal)).toEqual([bob.copyId]);
  });

  it('disconnecting the last one removes the calendar', async () => {
    const { cal, alice, bob } = await twoConnectionsOneCalendar();
    await disconnect(alice.id);
    expect(await disconnect(bob.id)).toMatchObject({ remote: 'cleaned' });
    expect(fake.store.hasCalendar(cal)).toBe(false);
  });

  it('a write-off deletes only its copy and keeps the shared calendar', async () => {
    const { cal, alice, bob } = await twoConnectionsOneCalendar();
    await testApp.db
      .update(conns)
      .set({ writeEnabled: false })
      .where(eq(conns.id, alice.id));
    const deps = { db: testApp.db, registry: registry() };
    expect(await runCalendarWriteOff(deps, alice.id)).toEqual({
      result: 'done',
      deletedCopies: 1,
    });
    expect(fake.store.hasCalendar(cal)).toBe(true);
    expect(copyIdsIn(cal)).toEqual([bob.copyId]);
    const [row] = await testApp.db
      .select({ cal: conns.dedicatedCalendarId })
      .from(conns)
      .where(eq(conns.id, alice.id));
    expect(row?.cal).toBeNull();
  });

  it('keeps the calendar when the sibling references it only through a live copy link', async () => {
    const { cal, alice, bob } = await twoConnectionsOneCalendar();
    // Bob's row no longer names the calendar; only his copy link points at it.
    await testApp.db
      .update(conns)
      .set({ dedicatedCalendarId: null })
      .where(eq(conns.id, bob.id));
    // mutation: `linkedElsewhere` returning false makes this go red (deleted).
    expect(await disconnect(alice.id)).toMatchObject({ remote: 'cleaned' });
    expect(fake.store.hasCalendar(cal)).toBe(true);
    expect(copyIdsIn(cal)).toEqual([bob.copyId]);
  });

  it('removes the calendar when both connections are already disconnecting', async () => {
    const { cal, alice, bob } = await twoConnectionsOneCalendar();
    // Bob is mid-disconnect too: his row and copy link still name the calendar.
    await testApp.db
      .update(conns)
      .set({ status: 'disconnecting' })
      .where(eq(conns.id, bob.id));
    // mutation: dropping `ne(status, 'disconnecting')` from `siblingsOf`
    // counts Bob as live and leaves the calendar, so this goes red.
    expect(await disconnect(alice.id)).toMatchObject({ remote: 'cleaned' });
    expect(fake.store.hasCalendar(cal)).toBe(false);
  });

  it('a lone connection still removes its own calendar on disconnect', async () => {
    const cal = fake.store.createCalendar('Raid Ledger');
    const eventId = await createFutureEvent(testApp, adminToken);
    const { id } = await connectTo(cal, 'solo', eventId);
    await disconnect(id);
    expect(fake.store.hasCalendar(cal)).toBe(false);
  });
});
