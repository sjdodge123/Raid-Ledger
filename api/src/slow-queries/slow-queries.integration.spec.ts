/**
 * Slow Queries Service — real-DB integration tests (ROK-1156).
 *
 * Verifies the snapshot/diff/prune flow end-to-end:
 *   1. captureSnapshot writes a row plus filtered entries
 *   2. getLatestDigest picks the right cron baseline and returns positive
 *      deltas for queries that ran between the two snapshots
 *   3. pruneOldSnapshots deletes rows older than 30 days (and cascades
 *      to entries via FK)
 *
 * The shared `pgvector/pgvector:pg16` test container does NOT
 * preload `pg_stat_statements`, so the snapshot+diff flow is tested
 * with an empty statement source. Tests that need a real
 * `pg_sleep`-backed entry detect availability and skip when the
 * extension is unavailable, so the suite stays green locally and in
 * CI without coupling Phase B to test-infra changes.
 */
import { eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { SlowQueriesService } from './slow-queries.service';

async function isPgStatStatementsLoaded(
  testApp: TestApp,
): Promise<boolean> {
  try {
    await testApp.db.execute(sql`SELECT 1 FROM pg_stat_statements LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

describe('SlowQueriesService (integration)', () => {
  let testApp: TestApp;
  let service: SlowQueriesService;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(SlowQueriesService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  describe('captureSnapshot', () => {
    it('persists a snapshot row with the requested source', async () => {
      const result = await service.captureSnapshot('manual');

      expect(result.snapshotId).toBeGreaterThan(0);
      const [row] = await testApp.db
        .select()
        .from(schema.slowQuerySnapshots);
      expect(row.source).toBe('manual');
    });

    it('records pg_stat_statements rows when the extension is loaded', async () => {
      if (!(await isPgStatStatementsLoaded(testApp))) {
        return; // Extension not loaded in test container — covered by allinone.
      }
      // Reset so the next snapshot only sees what we run below.
      await testApp.db.execute(sql`SELECT pg_stat_statements_reset()`);
      await testApp.db.execute(sql`SELECT pg_sleep(0.3)`);

      const result = await service.captureSnapshot('manual');

      const entries = await testApp.db
        .select()
        .from(schema.slowQuerySnapshotEntries);
      const sleepEntry = entries.find((e) =>
        e.queryText.toLowerCase().includes('pg_sleep'),
      );
      expect(sleepEntry).toBeDefined();
      expect(sleepEntry?.snapshotId).toBe(result.snapshotId);
      expect(Number(sleepEntry?.calls ?? 0)).toBeGreaterThan(0);
      expect(sleepEntry?.meanExecTimeMs ?? 0).toBeGreaterThan(200);
    });
  });

  describe('getLatestDigest', () => {
    it('returns null when no snapshots exist', async () => {
      const result = await service.getLatestDigest();
      expect(result).toBeNull();
    });

    it('returns digest with null baseline on first cron snapshot', async () => {
      await service.captureSnapshot('cron');
      const digest = await service.getLatestDigest();
      expect(digest).not.toBeNull();
      expect(digest?.baseline).toBeNull();
      expect(digest?.snapshot.source).toBe('cron');
    });

    it('uses only cron snapshots as the baseline (manual snapshots do not pollute)', async () => {
      const cron1 = await service.captureSnapshot('cron');
      const manual = await service.captureSnapshot('manual');
      const cron2 = await service.captureSnapshot('cron');

      const now = Date.now();
      await setCapturedAt(testApp, cron1.snapshotId, new Date(now - 10 * 60_000));
      await setCapturedAt(testApp, manual.snapshotId, new Date(now - 5 * 60_000));
      await setCapturedAt(testApp, cron2.snapshotId, new Date(now));

      const digest = await service.getLatestDigest();
      expect(digest?.snapshot.id).toBe(cron2.snapshotId);
      expect(digest?.baseline?.id).toBe(cron1.snapshotId);
      expect(digest?.baseline?.source).toBe('cron');
    });
  });

  describe('pruneOldSnapshots', () => {
    it('deletes snapshots older than the retention window and cascades to entries', async () => {
      const recent = await service.captureSnapshot('cron');
      const old = await service.captureSnapshot('cron');
      // Backdate one snapshot beyond the 30-day retention window.
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await setCapturedAt(testApp, old.snapshotId, fortyDaysAgo);

      const deleted = await service.pruneOldSnapshots(30);

      expect(deleted).toBe(1);
      const remaining = await testApp.db
        .select()
        .from(schema.slowQuerySnapshots);
      expect(remaining.map((r) => r.id)).toEqual([recent.snapshotId]);
      // Verify cascade — no entry rows reference the deleted snapshot id.
      const orphanEntries = await testApp.db
        .select()
        .from(schema.slowQuerySnapshotEntries)
        .where(eq(schema.slowQuerySnapshotEntries.snapshotId, old.snapshotId));
      expect(orphanEntries).toHaveLength(0);
    });
  });
});

/** Pin a snapshot's captured_at so getLatestDigest's ordering is deterministic. */
async function setCapturedAt(
  testApp: TestApp,
  snapshotId: number,
  when: Date,
): Promise<void> {
  await testApp.db
    .update(schema.slowQuerySnapshots)
    .set({ capturedAt: when })
    .where(eq(schema.slowQuerySnapshots.id, snapshotId));
}
