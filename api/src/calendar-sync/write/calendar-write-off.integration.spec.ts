/**
 * ROK-1596 review P2: the `write-off` job against Postgres + the Fake
 * provider — the final delete only drops suppressed links (m2), a permanent
 * 4xx ends it `failed` without a retry (m6), and an auth error leaves the
 * unfinished-write-off marker that `enqueuePendingWriteOff` re-queues on
 * reconnect (m3). Jobs are run by calling the helper directly.
 */
import { eq } from 'drizzle-orm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
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
import {
  CALENDAR_WRITE_QUEUE,
  writeOffJobId,
} from '../calendar-sync.constants';
import {
  ProviderAuthError,
  ProviderRequestError,
} from '../providers/calendar-provider.errors';
import {
  CALENDAR_FAKE_PROVIDER,
  CalendarProviderRegistry,
} from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { CalendarWriteProcessor } from './calendar-write.processor';
import {
  enqueuePendingWriteOff,
  hasPendingWriteOff,
  runCalendarWriteOff,
} from './calendar-write-off.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const conns = schema.calendarConnections;
const links = schema.calendarEventLinks;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let processor: CalendarWriteProcessor;
let queue: Queue;
let deps: Parameters<typeof runCalendarWriteOff>[0];
let userId: number;
let adminToken: string;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  processor = testApp.app.get(CalendarWriteProcessor);
  queue = testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  deps = {
    db: testApp.db,
    registry: testApp.app.get(CalendarProviderRegistry),
  };
  await processor.worker.pause(true);
});

afterAll(() => processor.worker.resume());

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  await queue.drain(true);
  for (const c of fake.store.allCopies()) fake.store.deleteCopy(c.id);
  seq += 1;
  const member = await createMemberAndLogin(
    testApp,
    `cal-wo-${seq}`,
    `cal-wo-${seq}@example.test`,
  );
  userId = member.userId;
});

afterEach(async () => {
  fake.store.clearFailures();
  await queue.drain(true);
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Write off, a dedicated calendar holding one live (synced) copy. */
async function seedWriteOff(): Promise<{ id: number; calendarId: string }> {
  const result = fake.seedConnection({ id: `wo-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  const calendarId = fake.store.createCalendar('Raid Ledger');
  await testApp.db
    .update(conns)
    .set({ writeEnabled: false, dedicatedCalendarId: calendarId })
    .where(eq(conns.id, id));
  await addLink(id, calendarId, 'synced');
  return { id, calendarId };
}

async function addLink(
  connectionId: number,
  calendarId: string,
  state: 'synced' | 'suppressed',
): Promise<void> {
  const eventId = await createFutureEvent(testApp, adminToken, {
    title: `Raid ${state}`,
  });
  const copy = fake.store.upsertCopy(
    calendarId,
    {
      copyId: `rl:wo:${eventId}:${userId}`,
      title: 'Raid',
      description: '',
      url: 'https://raid.example.test',
      busy: true,
      start: new Date('2026-12-01T19:00:00Z'),
      end: new Date('2026-12-01T22:00:00Z'),
    },
    null,
  );
  await testApp.db.insert(links).values({
    connectionId,
    userId,
    eventId,
    calendarId,
    providerEventId: copy.id,
    state,
  });
}

const statesOf = async (connectionId: number) =>
  (
    await testApp.db
      .select({ state: links.state })
      .from(links)
      .where(eq(links.connectionId, connectionId))
  ).map((l) => l.state);

describe('write-off job — review P2 fixes', () => {
  it('m2: a link written mid-run (concurrent reconcile) survives the final delete; suppressed rows go', async () => {
    const { id, calendarId } = await seedWriteOff();
    await addLink(id, calendarId, 'suppressed');
    const realDelete = fake.deleteEvent.bind(fake);
    const spy = jest
      .spyOn(fake, 'deleteEvent')
      .mockImplementationOnce(async (creds, ref) => {
        await addLink(id, 'primary', 'synced'); // lands after `live` was read
        return realDelete(creds, ref);
      });
    try {
      await expect(runCalendarWriteOff(deps, id)).resolves.toEqual({
        result: 'done',
        deletedCopies: 1,
      });
    } finally {
      spy.mockRestore();
    }
    expect(await statesOf(id)).toEqual(['synced']);
  });

  it('m6: a permanent 4xx ends the job failed (resolves, no BullMQ retry)', async () => {
    const { id } = await seedWriteOff();
    fake.store.failNext(new ProviderRequestError('http_400'));
    await expect(runCalendarWriteOff(deps, id)).resolves.toEqual({
      result: 'failed',
      reason: 'rejected:http_400',
    });
  });

  it('m3: an auth error leaves the marker; enqueuePendingWriteOff re-queues the job, a finished one does not', async () => {
    const { id, calendarId } = await seedWriteOff();
    fake.store.failNext(new ProviderAuthError('invalid_grant'));
    const failed = await runCalendarWriteOff(deps, id);
    expect(failed).toMatchObject({ result: 'failed' });
    expect(await hasPendingWriteOff(testApp.db, id)).toBe(true);
    const enqueueDeps = { queue, isSyncEnabled: () => Promise.resolve(true) };
    await expect(
      enqueuePendingWriteOff(testApp.db, enqueueDeps, id),
    ).resolves.toEqual({ outcome: 'added', jobId: writeOffJobId(id) });
    await queue.drain(true);
    await testApp.db // the reconnect
      .update(conns)
      .set({ status: 'active', lastErrorCode: null })
      .where(eq(conns.id, id));

    await expect(runCalendarWriteOff(deps, id)).resolves.toEqual({
      result: 'done',
      deletedCopies: 1,
    });
    expect(fake.store.hasCalendar(calendarId)).toBe(false);
    expect(await hasPendingWriteOff(testApp.db, id)).toBe(false);
    await expect(
      enqueuePendingWriteOff(testApp.db, enqueueDeps, id),
    ).resolves.toBeNull();
  });
});
