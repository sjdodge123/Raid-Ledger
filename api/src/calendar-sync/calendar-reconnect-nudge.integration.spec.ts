/**
 * ROK-1866 — the "reconnect your calendar" nudge against a real DB: one
 * `calendar_needs_reconnect` notification per `needs_reconnect` episode.
 *
 * F1 (read auth failure) runs end to end through `CalendarReadProcessor`
 * with the Fake provider; the write sites (F2/F3) emit the same event from
 * `CalendarWriteProcessor.afterFailure` (pinned in its unit spec), so the
 * dedupe / reset / gate cases drive the event directly.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { DEFAULT_CHANNEL_PREFS } from '../drizzle/schema/notification-preferences';
import { CalendarReconnectNudgeListener } from '../notifications/calendar-reconnect-nudge.listener';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import { CALENDAR_NEEDS_RECONNECT_EVENT } from './calendar-needs-reconnect.events';
import { ProviderAuthError } from './providers/calendar-provider.errors';
import { CALENDAR_FAKE_PROVIDER } from './providers/calendar-provider.registry';
import type { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from './services/calendar-connect.helpers';
import type { CalendarReadJobData } from './read/calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import { CalendarWriteProcessor } from './write/calendar-write.processor';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let listener: CalendarReconnectNudgeListener;
let readProcessor: CalendarReadProcessor;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  listener = testApp.app.get(CalendarReconnectNudgeListener);
  readProcessor = testApp.app.get(CalendarReadProcessor);
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
});

beforeEach(async () => {
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  fake.store.clearFailures();
});

afterEach(async () => {
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

type ConnRow = typeof schema.calendarConnections.$inferInsert;

/** A member with a Fake connection, read granted + enabled. */
async function member(patch: Partial<ConnRow> = {}) {
  seq += 1;
  const { userId } = await createMemberAndLogin(
    testApp,
    `cal-nudge-${seq}`,
    `cal-nudge-${seq}@example.test`,
  );
  const reconnect = () =>
    upsertCalendarConnection(testApp.db, {
      userId,
      provider: 'google',
      result: fake.seedConnection({ id: `nudge-${seq}` }),
    });
  const { id } = await reconnect();
  await setConn(id, { readAccessGranted: true, readEnabled: true, ...patch });
  return { userId, connectionId: id, reconnect };
}

function setConn(id: number, patch: Partial<ConnRow>) {
  return testApp.db
    .update(schema.calendarConnections)
    .set(patch)
    .where(eq(schema.calendarConnections.id, id));
}

async function nudgesOf(userId: number) {
  const n = schema.notifications;
  return testApp.db
    .select()
    .from(n)
    .where(and(eq(n.userId, userId), eq(n.type, 'calendar_needs_reconnect')));
}

async function nudgedAt(id: number): Promise<Date | null> {
  const c = schema.calendarConnections;
  const rows = await testApp.db.select().from(c).where(eq(c.id, id));
  return nonEmpty(rows)[0].reconnectNudgedAt;
}

const flip = (id: number) => setConn(id, { status: 'needs_reconnect' });
const nudge = (connectionId: number) => listener.handle({ connectionId });

function readJob(connectionId: number): Job<CalendarReadJobData> {
  return {
    data: { kind: 'sync', connectionId },
    attemptsMade: 0,
    opts: { attempts: 4 },
  } as unknown as Job<CalendarReadJobData>;
}

describe('ROK-1866 reconnect nudge', () => {
  it('AC1 F1: a read auth failure flips the row and sends exactly one nudge', async () => {
    const m = await member();
    fake.failNextFetch(new ProviderAuthError('invalid_grant'));
    await expect(readProcessor.process(readJob(m.connectionId))).rejects.toThrow();
    await waitFor(async () => {
      expect(await nudgesOf(m.userId)).toHaveLength(1);
    }, 5_000);
    const [row] = nonEmpty(await nudgesOf(m.userId));
    expect(row.title).toBe('Reconnect your Google calendar');
    expect(row.payload).toEqual(
      expect.objectContaining({ url: '/profile/integrations' }),
    );
    expect(await nudgedAt(m.connectionId)).toBeInstanceOf(Date);
  });

  it('AC2: repeat and concurrent failures in one episode send nothing more', async () => {
    const m = await member();
    await flip(m.connectionId);
    const sent = await Promise.all([
      nudge(m.connectionId),
      nudge(m.connectionId),
      nudge(m.connectionId),
    ]);
    expect(sent.filter(Boolean)).toHaveLength(1);
    expect(await nudge(m.connectionId)).toBe(false);
    expect(await nudgesOf(m.userId)).toHaveLength(1);
  });

  it('AC3: a reconnect clears the episode; the next flip sends one more', async () => {
    const m = await member();
    await flip(m.connectionId);
    expect(await nudge(m.connectionId)).toBe(true);
    await m.reconnect();
    expect(await nudgedAt(m.connectionId)).toBeNull();
    await flip(m.connectionId);
    expect(await nudge(m.connectionId)).toBe(true);
    expect(await nudge(m.connectionId)).toBe(false);
    expect(await nudgesOf(m.userId)).toHaveLength(2);
  });

  it('AC4: in-app muted → no in-app row (the episode is still claimed)', async () => {
    const m = await member();
    await testApp.db.insert(schema.userNotificationPreferences).values({
      userId: m.userId,
      channelPrefs: {
        ...DEFAULT_CHANNEL_PREFS,
        calendar_needs_reconnect: { inApp: false, push: false, discord: false },
      },
    });
    await flip(m.connectionId);
    await nudge(m.connectionId);
    expect(await nudgesOf(m.userId)).toHaveLength(0);
  });

  it('AC4: a deactivated user gets nothing and the episode stays unclaimed', async () => {
    const m = await member();
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, m.userId));
    await flip(m.connectionId);
    expect(await nudge(m.connectionId)).toBe(false);
    expect(await nudgesOf(m.userId)).toHaveLength(0);
    expect(await nudgedAt(m.connectionId)).toBeNull();
  });

  it('AC4: calendar sync off → nothing and not claimed; re-enabled → one nudge', async () => {
    const m = await member();
    await flip(m.connectionId);
    await setCalendarSyncEnabled(settings, false);
    expect(await nudge(m.connectionId)).toBe(false);
    expect(await nudgedAt(m.connectionId)).toBeNull();
    await setCalendarSyncEnabled(settings, true);
    expect(await nudge(m.connectionId)).toBe(true);
    expect(await nudgesOf(m.userId)).toHaveLength(1);
  });

  it('an active (not flipped) connection is never nudged', async () => {
    const m = await member();
    testApp.app
      .get(EventEmitter2)
      .emit(CALENDAR_NEEDS_RECONNECT_EVENT, { connectionId: m.connectionId });
    expect(await nudge(m.connectionId)).toBe(false);
    expect(await nudgesOf(m.userId)).toHaveLength(0);
  });

  it('AC6: a needs_reconnect row written without the event (demo seed) never nudges', async () => {
    const m = await member({ status: 'needs_reconnect' });
    expect(await nudgesOf(m.userId)).toHaveLength(0);
    expect(await nudgedAt(m.connectionId)).toBeNull();
  });
});
