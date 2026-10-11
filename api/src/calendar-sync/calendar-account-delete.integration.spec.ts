/**
 * ROK-1596 D12 (Q11): `DELETE /users/:id` (admin) awaits `user.deleting`;
 * `CalendarAccountDeleteListener` removes the user's remote copies, the
 * dedicated calendar and the grant best-effort BEFORE the cascade. A provider
 * that throws or hangs never fails or stalls the account delete.
 * Fake provider (`demo-fake:` rows, DEMO_MODE double gate).
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
import { SettingsService } from '../settings/settings.service';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import { TransientError } from './providers/calendar-provider.errors';
import { FAKE_PRIMARY_CALENDAR_ID } from './providers/testing/fake-calendar-store';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import {
  ACCOUNT_DELETE_BUDGET_MS,
  CalendarAccountDeleteListener,
} from './write/calendar-account-delete.listener';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let listener: CalendarAccountDeleteListener;
let adminToken: string;
let member: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  listener = testApp.app.get(CalendarAccountDeleteListener);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  member = await createMemberAndLogin(
    testApp,
    `cal-ad-${seq}`,
    `cal-ad-${seq}@example.test`,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  listener.budgetMs = ACCOUNT_DELETE_BUDGET_MS;
  await testApp.app.get(SettingsService).setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A fake connection with one primary copy and a dedicated calendar. */
async function seedCalendarState() {
  const result = fake.seedConnection({ id: `ad-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId: member.userId,
    provider: 'google',
    result,
  });
  const dedicated = fake.store.createCalendar('Raid Ledger');
  await testApp.db
    .update(schema.calendarConnections)
    .set({ dedicatedCalendarId: dedicated })
    .where(eq(schema.calendarConnections.id, id));
  const eventId = await createFutureEvent(testApp, adminToken);
  const copy = fake.store.upsertCopy(
    FAKE_PRIMARY_CALENDAR_ID,
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
    connectionId: id,
    userId: member.userId,
    eventId,
    calendarId: FAKE_PRIMARY_CALENDAR_ID,
    providerEventId: copy.id,
  });
  const creds = result.credentials;
  const refresh = creds.kind === 'oauth' ? creds.refreshToken : '';
  return { id, dedicated, refresh };
}

function deleteMember() {
  return testApp.request
    .delete(`/users/${member.userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
}

async function userExists(): Promise<boolean> {
  const rows = await testApp.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, member.userId));
  return rows.length > 0;
}

describe('account delete → calendar cleanup (D12, Q11)', () => {
  it('removes the remote copies + dedicated calendar and revokes, then deletes the user', async () => {
    const { id, dedicated, refresh } = await seedCalendarState();
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toHaveLength(1);
    expect((await deleteMember()).status).toBe(204);
    expect(fake.store.copiesIn(FAKE_PRIMARY_CALENDAR_ID)).toEqual([]);
    expect(fake.store.hasCalendar(dedicated)).toBe(false);
    expect(fake.revoked).toContain(refresh);
    expect(await userExists()).toBe(false);
    const rows = await testApp.db
      .select()
      .from(schema.calendarConnections)
      .where(eq(schema.calendarConnections.id, id));
    expect(rows).toEqual([]);
  });

  it('the provider throwing → the user is still deleted', async () => {
    await seedCalendarState();
    jest
      .spyOn(fake, 'deleteEvent')
      .mockRejectedValue(new TransientError('http_503'));
    expect((await deleteMember()).status).toBe(204);
    expect(await userExists()).toBe(false);
  });

  it('the provider hanging → abandoned at the budget, the user is still deleted', async () => {
    await seedCalendarState();
    listener.budgetMs = 200;
    // Slow, not infinite: without the budget the delete takes ≥ 3 s and the
    // elapsed-time assertion below states that, instead of a jest timeout.
    jest
      .spyOn(fake, 'deleteEvent')
      .mockImplementation(() => new Promise((r) => setTimeout(r, 3_000)));
    const started = Date.now();
    expect((await deleteMember()).status).toBe(204);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await userExists()).toBe(false);
  });
});
