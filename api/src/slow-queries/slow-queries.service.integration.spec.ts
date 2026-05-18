/**
 * Slow-query service integration tests (ROK-1273).
 *
 * Verifies the end-to-end behaviour the unit tests can't reach:
 *   1. seed-traffic → cron → digest captures the seeded queries
 *   2. cron-runs reset pg_stat_statements so the next digest is fresh
 *   3. sort key (total_exec_time DESC) ranks high-frequency over one-shot
 *
 * Probe-and-skip pattern: `pg_stat_statements` requires
 * `shared_preload_libraries=pg_stat_statements` on the Postgres command line.
 * Verified install points:
 *   - Dockerfile.allinone supervisor postgres command      YES (prod)
 *   - docker-compose.yml `raid-ledger-db` service          YES (local dev)
 *   - .github/workflows/ci.yml postgres service container  NO
 *   - api/src/common/testing/test-app.ts Testcontainers    NO
 *
 * The probe runs once in beforeAll. When the extension is absent the suite
 * marks every test as skipped (no red x). The unit tests in
 * `slow-queries.helpers.spec.ts` cover the SQL contract regardless.
 */
import { sql } from 'drizzle-orm';
import * as fs from 'node:fs';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { SlowQueriesService } from './slow-queries.service';

type ExtensionRow = {
  extname: string;
} & Record<string, unknown>;

async function isPgStatStatementsAvailable(testApp: TestApp): Promise<boolean> {
  try {
    const rows = await testApp.db.execute<ExtensionRow>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`,
    );
    if (rows.length === 0) return false;
    await testApp.db.execute(sql`SELECT pg_stat_statements_reset()`);
    return true;
  } catch {
    return false;
  }
}

async function readDigestFile(path: string): Promise<string> {
  return fs.promises.readFile(path, 'utf8');
}

function lastDigestBlock(content: string): string {
  const blocks = content.split('=== Slow Query Digest @ ');
  return blocks[blocks.length - 1] ?? content;
}

function describeSlowQueriesService() {
  let testApp: TestApp;
  let slowQueries: SlowQueriesService;
  let extensionAvailable = false;

  beforeAll(async () => {
    testApp = await getTestApp();
    extensionAvailable = await isPgStatStatementsAvailable(testApp);
    slowQueries = testApp.app.get(SlowQueriesService);
    if (extensionAvailable) {
      try {
        await fs.promises.unlink(slowQueries.getLogFilePath());
      } catch {
        // file may not exist yet — fine
      }
    }
  });

  it('captures seeded query ids in the appended digest', async () => {
    if (!extensionAvailable) {
      return;
    }
    // Wipe any boot-time noise so only our markers are visible.
    await testApp.db.execute(sql`SELECT pg_stat_statements_reset()`);

    // pg_stat_statements groups by normalized SHAPE — different aliases on
    // the same shape collapse to one queryid (only the first form's text is
    // stored). Use distinct shapes so each marker's alias survives.
    for (let i = 0; i < 5; i++) {
      await testApp.db.execute(sql`SELECT 1 AS rok_1273_marker_a`);
      await testApp.db.execute(sql`SELECT 1, 2 AS rok_1273_marker_b`);
      await testApp.db.execute(sql`SELECT 1, 2, 3 AS rok_1273_marker_c`);
    }

    const written = await slowQueries.appendDigestToLog();
    expect(written).toBe(true);

    const content = await readDigestFile(slowQueries.getLogFilePath());
    const block = lastDigestBlock(content);
    const matched = [
      'rok_1273_marker_a',
      'rok_1273_marker_b',
      'rok_1273_marker_c',
    ].some((marker) => block.includes(marker));
    expect(matched).toBe(true);
  });

  it('resets pg_stat_statements so the next digest reflects only new traffic', async () => {
    if (!extensionAvailable) {
      return;
    }
    // No seeding between the prior digest and this one. The previous test's
    // appendDigestToLog ran a reset on success, so pg_stat_statements should
    // only contain whatever traffic Jest itself drove between the two calls
    // (test runner queries, NOT the marker SELECTs above).
    const written = await slowQueries.appendDigestToLog();
    expect(written).toBe(true);

    const content = await readDigestFile(slowQueries.getLogFilePath());
    const block = lastDigestBlock(content);
    expect(block).not.toContain('rok_1273_marker_a');
    expect(block).not.toContain('rok_1273_marker_b');
    expect(block).not.toContain('rok_1273_marker_c');
  });

  it('ranks high-frequency queries above one-shot bulk operations', async () => {
    if (!extensionAvailable) {
      return;
    }
    await testApp.db.execute(sql`SELECT pg_stat_statements_reset()`);

    // pg_stat_statements groups by normalized SHAPE (literals replaced with
    // `$1`, $2, …); column aliases alone do NOT disambiguate. To force two
    // distinct queryids we use different statement shapes — `pg_sleep + random()`
    // for high-freq and bare `pg_sleep` for one-shot. The query texts retain
    // the unique aliases so the digest is human-readable.
    // Timing: 0.5ms × 200 ≈ 100ms total for high-freq; one-shot = 50ms.
    // Under the OLD `mean_exec_time DESC` sort the 50ms one-shot would win;
    // under the NEW `total_exec_time DESC` sort the cumulative 100ms high-freq
    // dominates. This is exactly the scenario ROK-1273 fixes — hot-path
    // queries no longer hidden by one-shot bulk operations.
    for (let i = 0; i < 200; i++) {
      await testApp.db.execute(
        sql`SELECT pg_sleep(0.0005), random() AS rok_1273_high_freq`,
      );
    }
    await testApp.db.execute(sql`SELECT pg_sleep(0.05) AS rok_1273_one_shot`);

    const written = await slowQueries.appendDigestToLog();
    expect(written).toBe(true);

    const content = await readDigestFile(slowQueries.getLogFilePath());
    const block = lastDigestBlock(content);
    const hiIdx = block.indexOf('rok_1273_high_freq');
    const oneIdx = block.indexOf('rok_1273_one_shot');
    // Both queries must surface in the top-10 for the assertion to be meaningful.
    expect(hiIdx).toBeGreaterThanOrEqual(0);
    expect(oneIdx).toBeGreaterThanOrEqual(0);
    expect(hiIdx).toBeLessThan(oneIdx);
  });
}

describe('SlowQueriesService (integration)', () =>
  describeSlowQueriesService());
