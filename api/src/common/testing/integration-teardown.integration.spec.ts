/**
 * ROK-1232 — failing TDD repros: integration teardown gaps.
 *
 * Three tests, each codifying a deterministic leak vector that survives
 * `truncateAllTables` today and must be closed by the dev's
 * `resetIntegrationState()` (or extended `truncateAllTables`).
 *
 * Vector 1: SettingsService in-memory cache survives truncate.
 *   `settings.service.ts` caches decrypted app_settings in a Map with a
 *   30-minute TTL. `truncateAllTables` wipes the `app_settings` table but
 *   does NOT clear the cache; the next spec sees stale values written by
 *   the previous spec.
 *
 * Vector 2: Notification dedup keys survive truncate.
 *   The Playwright reset (`demo-test-reset.service.ts:flushDedupRedisCache`)
 *   sweeps `lineup-*`, `event-*`, `tiebreaker-*`, `scheduling-*`,
 *   `standalone-poll-*`. The integration teardown only sweeps `jwt_block:*`.
 *   A dedup write in spec A silences a notification in spec B.
 *
 * Vector 3: Cron jobs run during the test window (ROK-1223).
 *   `ScheduleModule.forRoot()` registers every `@Cron` decorator into the
 *   shared `SchedulerRegistry`. Today nothing pauses or short-circuits
 *   them in `NODE_ENV === 'test'`, so a 5-min cron handler can fire
 *   inside a long integration suite, mutating DB state out of band.
 *
 * Each test is expected to FAIL on current main and pass after the dev
 * lands the additive teardown / cron pause.
 *
 * Hard rule (build template): tests only — no source-code edits, no
 * helper additions, no harness changes. Run via:
 *   npm run test:integration -w api -- common/testing/integration-teardown
 */
import { SchedulerRegistry } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from './test-app';
import { truncateAllTables } from './integration-helpers';
import { SettingsService } from '../../settings/settings.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';

function describeTeardownGaps() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ── Vector 1: SettingsService cache survives truncate ───────────────
  it('clears the SettingsService in-memory cache so a fresh setting read after truncate misses', async () => {
    const settings = testApp.app.get(SettingsService);

    // Write a setting that any subsequent spec might read for an
    // operational decision (e.g. community name on an embed).
    await settings.set('community_name', 'rok-1232-leak-canary');
    expect(await settings.get('community_name')).toBe('rok-1232-leak-canary');

    // The canonical "between specs" reset.
    testApp.seed = await truncateAllTables(testApp.db);

    // The DB row is gone — confirm the test's SQL premise is correct.
    const rows = await testApp.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM app_settings WHERE key = 'community_name'`,
    );
    expect(rows[0]?.count).toBe('0');

    // The bug: cache TTL is 30 minutes, `truncateAllTables` does not clear
    // it, so the in-memory copy still returns the previous value.
    // Until the dev adds a cache-reset step to the teardown surface, this
    // assertion fails — `get` returns the stale 'rok-1232-leak-canary'.
    expect(await settings.get('community_name')).toBeNull();
  });

  // ── Vector 2: dedup Redis keys survive truncate ─────────────────────
  it('clears notification dedup Redis keys (lineup-*/event-*/standalone-poll-*) so spec A cannot silence spec B', async () => {
    const dedup = testApp.app.get(NotificationDedupService);

    // Plant a representative key from each domain prefix the Playwright
    // reset already sweeps. `checkAndMarkSent` returns false (= not yet
    // sent) on first call and writes the key to Redis + DB.
    const keys = [
      'lineup-reminder:1:99:24h',
      'event-reminder:42:99:1h',
      'tiebreaker-veto:7:99',
      'scheduling-poll:13:99',
      'standalone-poll-reminder:55:99:24h',
    ];
    for (const k of keys) {
      const alreadySent = await dedup.checkAndMarkSent(k, 3_600);
      expect(alreadySent).toBe(false);
    }

    // Sanity: the Redis mock now holds those keys.
    const storeBefore = testApp.redisMock.store;
    for (const k of keys) {
      expect(storeBefore.has(k)).toBe(true);
    }

    // The canonical reset.
    testApp.seed = await truncateAllTables(testApp.db);

    // After teardown, no dedup keys may remain. Today only `jwt_block:*`
    // is purged, so each of these survives — every assertion below fails
    // until the dev mirrors `flushDedupRedisCache` into the helper.
    const storeAfter = testApp.redisMock.store;
    const survivors = keys.filter((k) => storeAfter.has(k));
    expect(survivors).toEqual([]);
  });

  // ── Vector 3: crons remain registered + running during tests ────────
  it('disables registered cron jobs during integration tests so handlers cannot fire mid-spec', () => {
    const scheduler = testApp.app.get(SchedulerRegistry);
    const cronJobs = scheduler.getCronJobs();

    // The scheduler should hold cron registrations from real services
    // (e.g. StandalonePollReminderService_runReminders, the failure mode
    // in ROK-1223). If the registry is empty, the test premise is wrong.
    expect(cronJobs.size).toBeGreaterThan(0);

    // Every registered cron must be inert under NODE_ENV=test. The
    // `cron` library's CronJob exposes `isActive` — true while the
    // internal timer is armed (between `start()` and `stop()`).
    // ScheduleModule.forRoot() calls `start()` on every @Cron at
    // app.init() and nothing in the harness pauses them — so this
    // assertion fails for all 30+ jobs on main today.
    const stillActive: string[] = [];
    for (const [name, job] of cronJobs) {
      const isActive = (job as unknown as { isActive?: boolean }).isActive;
      if (isActive) stillActive.push(name);
    }
    expect(stillActive).toEqual([]);
  });
}

describe('Integration teardown gaps (ROK-1232)', () => describeTeardownGaps());
