/**
 * ROK-1593 review fixes (lane FA) — the read sync's guards against the
 * shared connection row, proven against a real Postgres + the Fake:
 *
 * 1. A final transient read failure leaves `status='active'` (the ROK-1596
 *    write fan-out still selects the row), backs `next_sync_at` off and the
 *    cron re-picks it once that passes; the last good blocks stay.
 * 3. The 404/410 prune applies to the LOCKED row's `read_calendar_ids`, so a
 *    settings PUT that landed during the fetch survives.
 * 4. The kill switch is re-checked inside the transaction, and the busy
 *    query returns nothing while the switch is off.
 * 5. A connection the write side moved to `needs_reconnect` mid-fetch is not
 *    flipped back to `active` (nor its `auth` code cleared).
 *
 * Lane F3: when EVERY calendar is refused (the real Google adapter's
 * fetch), the sync fails and the last good blocks stay.
 *
 * Lane F2: a policy-403 calendar is skipped (others commit, no prune,
 * `provider_error` recorded); the kill-switch purge waits behind a running
 * sync's row lock and then removes its blocks; a transient failure never
 * overwrites a write-side `needs_reconnect`'s `auth` code.
 *
 * The app's read/write workers are closed so no queued job races the test.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import { CALENDAR_READ_QUEUE, readSyncJobId } from '../calendar-sync.constants';
import { TransientError } from '../providers/calendar-provider.errors';
import {
  CALENDAR_FAKE_PROVIDER,
  type CalendarReadProvider,
} from '../providers/calendar-provider.registry';
import { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import * as googleHttp from '../providers/google/google-http';
import { GoogleCalendarAdapter } from '../providers/google/google.adapter';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { findUserWriteConnectionIds } from '../write/calendar-write-fanout.helpers';
import { CalendarWriteProcessor } from '../write/calendar-write.processor';
import { fetchCalendarBusyHours } from './calendar-busy-query.helpers';
import { CalendarReadCron } from './calendar-read.cron';
import {
  enqueueCalendarReadSync,
  type CalendarReadJobData,
} from './calendar-read.enqueue.helpers';
import { CalendarReadProcessor } from './calendar-read.processor';
import { recordReadSyncFailure } from './calendar-read-failure.helpers';
import { purgeAllCalendarReadData } from './calendar-read-purge.helpers';
import {
  runCalendarReadSync,
  type ReadSyncDeps,
} from './calendar-read-sync.helpers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const c = schema.calendarConnections;

let testApp: TestApp;
let fake: FakeCalendarProvider;
let settings: SettingsService;
let readQueue: Queue<CalendarReadJobData>;
let readProcessor: CalendarReadProcessor;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  fake = testApp.app.get<FakeCalendarProvider>(CALENDAR_FAKE_PROVIDER);
  settings = testApp.app.get(SettingsService);
  readQueue = testApp.app.get<Queue<CalendarReadJobData>>(
    getQueueToken(CALENDAR_READ_QUEUE),
  );
  readProcessor = testApp.app.get(CalendarReadProcessor);
  await readProcessor.worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
});

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(async () => {
  // The Fake provider is only resolved by the registry in demo mode.
  process.env.DEMO_MODE = 'true';
  await settings.setDemoMode(true);
  await setCalendarSyncEnabled(settings, true);
  for (const cal of fake.store.listCalendars())
    fake.store.removeCalendar(cal.id);
  fake.seedCalendars([{ id: FAKE_PRIMARY_CALENDAR_ID, name: 'Primary' }]);
  fake.store.clearFailures();
  await readQueue.drain(true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await readQueue.drain(true);
  await readQueue.clean(0, 1000, 'failed');
  await setCalendarSyncEnabled(settings, false);
  await settings.setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
});

const tomorrowAt = (hour: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY + hour * HOUR);
};

async function member(patch: Partial<typeof c.$inferInsert> = {}) {
  seq += 1;
  const { userId } = await createMemberAndLogin(
    testApp,
    `cal-guard-${seq}`,
    `cal-guard-${seq}@example.test`,
  );
  const result = fake.seedConnection({ id: `guard-${seq}` });
  const { id } = await upsertCalendarConnection(testApp.db, {
    userId,
    provider: 'google',
    result,
  });
  await testApp.db
    .update(c)
    .set({ readAccessGranted: true, readEnabled: true, ...patch })
    .where(eq(c.id, id));
  return { userId, connectionId: id };
}

async function row(id: number) {
  const rows = await testApp.db.select().from(c).where(eq(c.id, id));
  return nonEmpty(rows, 'connection')[0];
}

function blocksOf(connectionId: number) {
  const t = schema.calendarBusyBlocks;
  return testApp.db
    .select({ startsAt: t.startsAt })
    .from(t)
    .where(eq(t.connectionId, connectionId));
}

async function sync(
  id: number,
  stillAllowed?: () => Promise<boolean>,
  extra: Pick<ReadSyncDeps, 'afterBlocks'> = {},
) {
  return runCalendarReadSync(
    {
      db: testApp.db,
      provider: fake,
      clientUrl: await settings.getClientUrl(),
      defaultTimezone: 'UTC',
      ...(stillAllowed ? { stillAllowed } : {}),
      ...extra,
    },
    await row(id),
  );
}

function seedOneBlock(): void {
  fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, [
    { start: tomorrowAt(21), end: tomorrowAt(22), allDay: false },
  ]);
}

describe('fix 1 — a failed read never touches the shared status', () => {
  it('final transient failure: active, backed off, still a write target, re-picked when due', async () => {
    const m = await member({ writeEnabled: true });
    seedOneBlock();
    expect(await sync(m.connectionId)).toBe('synced');
    fake.failNextFetch(new TransientError('http_503'));
    await enqueueCalendarReadSync(
      { queue: readQueue, isSyncEnabled: () => Promise.resolve(true) },
      m.connectionId,
    );
    const job = await readQueue.getJob(readSyncJobId(m.connectionId));
    if (!job) throw new Error('read job not queued');
    job.attemptsMade = (job.opts.attempts ?? 1) - 1; // the final attempt
    const before = Date.now();
    await expect(readProcessor.process(job)).rejects.toBeInstanceOf(
      TransientError,
    );

    const after = await row(m.connectionId);
    expect(after.status).toBe('active');
    expect(after.lastErrorCode).toBe('provider_error');
    expect(after.nextSyncAt?.getTime() ?? 0).toBeGreaterThanOrEqual(
      before + HOUR,
    );
    expect(await findUserWriteConnectionIds(testApp.db, m.userId)).toEqual([
      m.connectionId,
    ]);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    const cron = testApp.app.get(CalendarReadCron);
    expect(await cron.run(new Date(before + 2 * HOUR))).toEqual([
      m.connectionId,
    ]);
  });
});

describe('fix 3 — the prune reads the locked row', () => {
  it('a calendar added by a settings PUT during the fetch survives the 404 prune', async () => {
    const primary = FAKE_PRIMARY_CALENDAR_ID;
    const m = await member({ readCalendarIds: [primary, 'gone-cal'] });
    const stale = await row(m.connectionId);
    await testApp.db
      .update(c)
      .set({ readCalendarIds: [primary, 'gone-cal', 'new-cal'] })
      .where(eq(c.id, m.connectionId));
    await runCalendarReadSync(
      {
        db: testApp.db,
        provider: fake,
        clientUrl: await settings.getClientUrl(),
        defaultTimezone: 'UTC',
      },
      stale,
    );
    expect((await row(m.connectionId)).readCalendarIds).toEqual([
      primary,
      'new-cal',
    ]);
  });
});

describe('fix 4 — kill switch', () => {
  it('switched off after the pre-transaction check → skipped, nothing written', async () => {
    const m = await member();
    seedOneBlock();
    const answers = [true, false];
    const outcome = await sync(m.connectionId, () =>
      Promise.resolve(answers.shift() ?? false),
    );
    expect(outcome).toBe('skipped');
    expect(await blocksOf(m.connectionId)).toEqual([]);
  });

  it('the busy query yields nothing while the switch is off (blocks still stored)', async () => {
    const m = await member();
    seedOneBlock();
    expect(await sync(m.connectionId)).toBe('synced');
    const start = tomorrowAt(0);
    const end = new Date(start.getTime() + DAY);
    expect(
      await fetchCalendarBusyHours(testApp.db, m.userId, start, end),
    ).not.toEqual([]);
    await setCalendarSyncEnabled(settings, false);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    expect(
      await fetchCalendarBusyHours(testApp.db, m.userId, start, end),
    ).toEqual([]);
  });
});

describe('fix 5 — success never overwrites a needs_reconnect', () => {
  it('a write-side needs_reconnect set during the fetch is kept (status + auth code)', async () => {
    const m = await member();
    seedOneBlock();
    // Only the pre-transaction check (no row lock held yet) flips the row.
    // A second call happens inside the locked tx only when the guard has
    // failed; it must not write the locked row or the test deadlocks.
    let calls = 0;
    const outcome = await sync(m.connectionId, async () => {
      calls += 1;
      if (calls > 1) return true;
      await testApp.db
        .update(c)
        .set({ status: 'needs_reconnect', lastErrorCode: 'auth' })
        .where(eq(c.id, m.connectionId));
      return true;
    });
    const after = await row(m.connectionId);
    expect([outcome, after.status, after.lastErrorCode]).toEqual([
      'skipped',
      'needs_reconnect',
      'auth',
    ]);
  });
});

describe('F2 — a policy-403 calendar is skipped, not fatal', () => {
  it('the other calendar commits; no prune; provider_error recorded; still active', async () => {
    const primary = FAKE_PRIMARY_CALENDAR_ID;
    fake.seedCalendars([{ id: 'policy-cal', name: 'Locked down' }]);
    const m = await member({ readCalendarIds: [primary, 'policy-cal'] });
    seedOneBlock();
    jest
      .spyOn(fake, 'fetchBusy')
      .mockImplementationOnce(async (creds, range, ids) => {
        const readable = ids.filter((id) => id !== 'policy-cal');
        const base = FakeCalendarProvider.prototype.fetchBusy;
        const out = await base.call(fake, creds, range, readable);
        return { ...out, unreadableCalendarIds: ['policy-cal'] };
      });
    expect(await sync(m.connectionId)).toBe('synced');
    const after = await row(m.connectionId);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    expect([after.status, after.lastErrorCode, after.readCalendarIds]).toEqual([
      'active',
      'provider_error',
      [primary, 'policy-cal'],
    ]);
  });
});

describe('F3 — every calendar refused keeps the last good blocks', () => {
  const policy403 = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../providers/google/__fixtures__/events-403-domain-policy.json',
      ),
      'utf8',
    ),
  ) as unknown;

  it('the Google fetch fails on an all-refused run; replaceBlocks never runs', async () => {
    const m = await member({ readCalendarIds: [FAKE_PRIMARY_CALENDAR_ID] });
    seedOneBlock();
    expect(await sync(m.connectionId)).toBe('synced');
    const synced = (await row(m.connectionId)).lastSyncedAt;
    jest
      .spyOn(googleHttp, 'googleJsonRequest')
      .mockResolvedValue({ status: 403, json: policy403, retryAfter: null });
    const google = testApp.app.get(GoogleCalendarAdapter);
    const creds = {
      kind: 'oauth' as const,
      accessToken: 'ya29.f3-fixture',
      refreshToken: 'rt',
      expiresAt: '2099-01-01T00:00:00.000Z',
      scopes: [],
    };
    jest
      .spyOn(fake, 'fetchBusy')
      .mockImplementationOnce((_c, range, ids) =>
        google.fetchBusy(creds, range, ids),
      );
    const err = await sync(m.connectionId).then(
      (outcome) => outcome,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TransientError);
    expect(await blocksOf(m.connectionId)).toHaveLength(1);
    expect((await row(m.connectionId)).lastSyncedAt).toEqual(synced);
  });
});

/** Sessions parked behind `pid`'s locks. */
async function parkedBehind(pid: number): Promise<number> {
  const rows = await testApp.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity a
    WHERE ${pid} = ANY(pg_blocking_pids(a.pid))`);
  return Number(rows[0]?.n ?? 0);
}

describe('F2 — the kill-switch purge serialises with a running sync', () => {
  it('purge waits behind the sync row lock, then deletes the blocks it committed', async () => {
    const m = await member();
    seedOneBlock();
    let purge: Promise<number[]> | null = null;
    const outcome = await sync(m.connectionId, undefined, {
      afterBlocks: async (tx) => {
        const [me] = await tx.execute<{ pid: number }>(
          sql`SELECT pg_backend_pid()::int AS pid`,
        );
        const pid = Number(me?.pid);
        const started = purgeAllCalendarReadData(testApp.db);
        purge = started;
        const parked = waitFor(
          async () => {
            expect(await parkedBehind(pid)).toBeGreaterThan(0);
          },
          5000,
          25,
        );
        // Without the lock the purge finishes first; the block check below
        // then fails with the blocks the sync committed after it.
        await Promise.race([started.then(() => undefined), parked]);
      },
    });
    expect(outcome).toBe('synced');
    const purged = await (purge ?? Promise.resolve([]));
    expect(await blocksOf(m.connectionId)).toEqual([]);
    expect(purged).toContain(m.userId);
  });
});

describe('F2 — a transient failure never overwrites a needs_reconnect', () => {
  it('auth code and next_sync_at kept when the write side flipped the row', async () => {
    const m = await member({
      status: 'needs_reconnect',
      lastErrorCode: 'auth',
      nextSyncAt: null,
    });
    await recordReadSyncFailure(
      testApp.db,
      await row(m.connectionId),
      new TransientError('http_503'),
      { finalAttempt: true },
    );
    const after = await row(m.connectionId);
    expect([after.status, after.lastErrorCode, after.nextSyncAt]).toEqual([
      'needs_reconnect',
      'auth',
      null,
    ]);
  });
});

describe('Codex r7 — the cursor is re-checked under the commit lock', () => {
  it('an `unchanged` answer to a cursor the purge cleared re-reads in full', async () => {
    const m = await member();
    seedOneBlock();
    const cursor = { w: 'window', 'c:home': '7' };
    await testApp.db
      .update(c)
      .set({ syncCursor: cursor })
      .where(eq(c.id, m.connectionId));
    const stale = await row(m.connectionId);
    await purgeAllCalendarReadData(testApp.db);
    // The fake has no cursor; read it as the interface to answer `unchanged`.
    const reader: CalendarReadProvider = fake;
    const original = reader.fetchBusy.bind(reader);
    const spy = jest
      .spyOn(reader, 'fetchBusy')
      .mockImplementation((creds, range, ids, sent) =>
        sent
          ? Promise.resolve({ blocks: [], unchanged: true, cursor: sent })
          : original(creds, range, ids),
      );
    try {
      const outcome = await runCalendarReadSync(
        {
          db: testApp.db,
          provider: fake,
          clientUrl: await settings.getClientUrl(),
          defaultTimezone: 'UTC',
        },
        stale,
      );
      // Without the re-check: 'unchanged', zero blocks, the cursor restored.
      expect(outcome).toBe('synced');
      expect(spy.mock.calls.map((call) => call[3])).toEqual([
        cursor,
        undefined,
      ]);
      expect(await blocksOf(m.connectionId)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
