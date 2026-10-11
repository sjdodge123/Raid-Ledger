/**
 * ROK-1596 review round 3: the dedicated-calendar compare-and-swap against
 * Postgres + the Fake provider, with the race forced from inside
 * `ensureRaidLedgerCalendar` (after the calendar is created, before the
 * claim). BLOCKER: a connection deleted there ends the job instead of
 * recursing forever. MINOR: a write-off that cleared the id while sending
 * went off is not undone by the claim (no orphan calendar or copy).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
} from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CALENDAR_FAKE_PROVIDER } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { CalendarWriteProcessor } from './calendar-write.processor';
import { reconcileCalendarCopy } from './calendar-write-reconcile.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const conns = schema.calendarConnections;
const links = schema.calendarEventLinks;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let userId: number;
let adminToken: string;
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
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  ({ userId } = await createMemberAndLogin(
    testApp,
    `cal-cl-${seq}`,
    `cal-cl-${seq}@example.test`,
  ));
});

afterEach(async () => {
  jest.restoreAllMocks();
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A signed-up event, then a write-on dedicated-target connection. */
async function setup(dedicatedCalendarId: string | null = null) {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: 'Raid Night',
  });
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status: 'signed_up',
    confirmationStatus: 'pending',
  });
  const result = fake.seedConnection({ id: `cl-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(conns)
    .set({ writeEnabled: true, writeTarget: 'dedicated', dedicatedCalendarId })
    .where(eq(conns.id, id));
  return { connectionId: id, eventId, userId };
}

/** Run `race` right after the Fake creates the calendar; report its id. */
function raceAfterCreate(race: () => Promise<unknown>): { created: string[] } {
  const seen = { created: [] as string[] };
  const real = fake.ensureRaidLedgerCalendar.bind(fake);
  jest
    .spyOn(fake, 'ensureRaidLedgerCalendar')
    .mockImplementationOnce(async (creds, knownId) => {
      const id = await real(creds, knownId);
      seen.created.push(id);
      await race();
      return id;
    });
  return seen;
}

/** Settles `p`, or 'hung' after `ms` — a regression fails fast, not by hang. */
async function within<T>(p: Promise<T>, ms = 5000): Promise<T | 'hung'> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<'hung'>((resolve) => {
    timer = setTimeout(() => resolve('hung'), ms);
  });
  try {
    return await Promise.race([p, bound]);
  } finally {
    clearTimeout(timer);
  }
}

const reconcile = (key: Awaited<ReturnType<typeof setup>>) =>
  reconcileCalendarCopy(
    testApp.app.get(CalendarWriteProcessor).reconcileDeps(),
    key,
  );

describe('dedicated-calendar claim — review round 3', () => {
  it('BLOCKER: the connection deleted between create and claim ends the job (no loop), its new calendar deleted', async () => {
    const key = await setup();
    const seen = raceAfterCreate(() =>
      testApp.db.delete(conns).where(eq(conns.id, key.connectionId)),
    );
    await expect(within(reconcile(key))).resolves.toEqual({
      result: 'noop',
      reason: 'connection_gone',
    });
    expect(seen.created).toHaveLength(1);
    expect(fake.store.hasCalendar(seen.created.at(0) ?? '')).toBe(false);
    expect(fake.store.allCopies()).toEqual([]);
  }, 15_000);

  it('MINOR: a write-off that cleared the id while sending went off is not re-claimed — no orphan calendar or copy', async () => {
    const key = await setup('cal-gone-remotely'); // ensure must create anew
    const seen = raceAfterCreate(() =>
      testApp.db
        .update(conns)
        .set({ writeEnabled: false, dedicatedCalendarId: null })
        .where(eq(conns.id, key.connectionId)),
    );
    await expect(within(reconcile(key))).resolves.toEqual({
      result: 'noop',
      reason: 'write_disabled',
    });
    expect(seen.created).toHaveLength(1);
    const [row] = await testApp.db
      .select({ id: conns.dedicatedCalendarId })
      .from(conns)
      .where(eq(conns.id, key.connectionId));
    expect(row).toEqual({ id: null });
    expect(fake.store.hasCalendar(seen.created.at(0) ?? '')).toBe(false);
    expect(fake.store.allCopies()).toEqual([]);
    const rows = await testApp.db
      .select()
      .from(links)
      .where(eq(links.connectionId, key.connectionId));
    expect(rows).toEqual([]);
  }, 15_000);
});
