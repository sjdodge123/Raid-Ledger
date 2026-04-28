/**
 * Unit tests for SlowQueriesService (ROK-1156).
 *
 * Mocks Drizzle so we can exercise the orchestration paths
 * (capture-snapshot writes, digest baseline lookup, prune deletion)
 * without a real DB. Real-DB behaviour is covered by the integration
 * suite in `slow-queries.integration.spec.ts`.
 */
import { Test } from '@nestjs/testing';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SlowQueriesService } from './slow-queries.service';

describe('SlowQueriesService', () => {
  let service: SlowQueriesService;
  let db: MockDb;

  beforeEach(async () => {
    db = createDrizzleMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SlowQueriesService,
        { provide: DrizzleAsyncProvider, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(SlowQueriesService);
  });

  describe('captureSnapshot', () => {
    it('inserts a snapshot row and returns its id + capturedAt', async () => {
      db.execute.mockResolvedValueOnce([]);
      const capturedAt = new Date('2026-04-28T06:00:00Z');
      db.returning.mockResolvedValueOnce([
        { id: 7, capturedAt, source: 'cron' },
      ]);

      const result = await service.captureSnapshot('cron');

      expect(result).toEqual({ snapshotId: 7, capturedAt });
      expect(db.insert).toHaveBeenCalled();
    });

    it('skips entry insert when pg_stat_statements returns no rows', async () => {
      db.execute.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([
        { id: 8, capturedAt: new Date(), source: 'manual' },
      ]);

      await service.captureSnapshot('manual');

      // Only the snapshot row insert happens — no entries insert.
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('falls back to empty rows when pg_stat_statements throws (extension not loaded)', async () => {
      db.execute.mockRejectedValueOnce(
        new Error('relation "pg_stat_statements" does not exist'),
      );
      const capturedAt = new Date();
      db.returning.mockResolvedValueOnce([
        { id: 9, capturedAt, source: 'cron' },
      ]);

      const result = await service.captureSnapshot('cron');

      expect(result.snapshotId).toBe(9);
      expect(db.insert).toHaveBeenCalledTimes(1); // snapshot row only
    });
  });

  describe('getLatestDigest', () => {
    it('returns null when no snapshots exist', async () => {
      db.limit.mockResolvedValueOnce([]); // findLatestSnapshot
      const result = await service.getLatestDigest();
      expect(result).toBeNull();
    });

    it('returns digest with null baseline on first run', async () => {
      const captured = new Date('2026-04-28T06:00:00Z');
      // findLatestSnapshot uses limit#1; findBaselineForCron's `.where()`
      // must keep chaining (returns `this`), then its `.limit()` (limit#2)
      // resolves to []; loadEntries(current.id) is `.where()` call #2.
      db.limit
        .mockResolvedValueOnce([{ id: 1, capturedAt: captured, source: 'cron' }])
        .mockResolvedValueOnce([]);
      db.where
        .mockReturnValueOnce(db) // findBaselineForCron — keep chain going
        .mockResolvedValueOnce([
          {
            queryid: BigInt('123'),
            queryText: 'SELECT 1',
            calls: BigInt('5'),
            meanExecTimeMs: 100,
            totalExecTimeMs: 500,
          },
        ]); // loadEntries(current.id)

      const result = await service.getLatestDigest();

      expect(result?.snapshot.id).toBe(1);
      expect(result?.baseline).toBeNull();
      expect(result?.entries).toHaveLength(1);
      expect(result?.entries[0].queryid).toBe('123');
      expect(result?.entries[0].calls).toBe(5);
    });

    it('respects limit when slicing diffed entries', async () => {
      const captured = new Date();
      db.limit
        .mockResolvedValueOnce([
          { id: 2, capturedAt: captured, source: 'manual' },
        ]) // findLatestSnapshot
        .mockResolvedValueOnce([]); // findBaselineForCron — none
      db.where
        .mockReturnValueOnce(db) // findBaselineForCron's where — keep chain
        .mockResolvedValueOnce([
          {
            queryid: BigInt('1'),
            queryText: 'a',
            calls: BigInt('1'),
            meanExecTimeMs: 300,
            totalExecTimeMs: 300,
          },
          {
            queryid: BigInt('2'),
            queryText: 'b',
            calls: BigInt('1'),
            meanExecTimeMs: 200,
            totalExecTimeMs: 200,
          },
          {
            queryid: BigInt('3'),
            queryText: 'c',
            calls: BigInt('1'),
            meanExecTimeMs: 100,
            totalExecTimeMs: 100,
          },
        ]);

      const result = await service.getLatestDigest(2);
      expect(result?.entries).toHaveLength(2);
      expect(result?.entries.map((e) => e.queryid)).toEqual(['1', '2']);
    });
  });

  describe('pruneOldSnapshots', () => {
    it('returns the number of deleted snapshots', async () => {
      db.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const deleted = await service.pruneOldSnapshots(30);
      expect(deleted).toBe(3);
      expect(db.delete).toHaveBeenCalled();
    });

    it('returns 0 and skips logging when nothing was pruned', async () => {
      db.returning.mockResolvedValueOnce([]);
      const deleted = await service.pruneOldSnapshots(30);
      expect(deleted).toBe(0);
    });
  });
});
