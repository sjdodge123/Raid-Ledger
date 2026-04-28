import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SlowQueryDigestDto,
  SlowQuerySnapshotDto,
  SourceDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  diffEntries,
  normalizeRawRow,
  selectPgStatStatementsSql,
  type RawPgStatStatementsRow,
  type SlowQueryEntryRecord,
} from './slow-queries.helpers';

const PRUNE_DAYS_DEFAULT = 30;
const DIGEST_LIMIT_DEFAULT = 10;
const SNAPSHOT_TOP_N = 100;

interface CapturedSnapshot {
  snapshotId: number;
  capturedAt: Date;
}

/**
 * Slow-query digest service (ROK-1156).
 *
 * Snapshots `pg_stat_statements`, persists per-statement counters, and
 * exposes a per-window diff for the admin Logs panel.
 */
@Injectable()
export class SlowQueriesService {
  private readonly logger = new Logger(SlowQueriesService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Read top-N from pg_stat_statements, persist a snapshot row + entries.
   * Returns the new snapshot id and capture time.
   */
  async captureSnapshot(source: SourceDto): Promise<CapturedSnapshot> {
    const rows = await this.readPgStatStatements();
    const snapshot = await this.insertSnapshotRow(source);
    if (rows.length > 0) {
      await this.insertEntries(snapshot.id, rows);
    }
    this.logger.log(
      `Captured slow-query snapshot id=${snapshot.id} source=${source} entries=${rows.length}`,
    );
    return { snapshotId: snapshot.id, capturedAt: snapshot.capturedAt };
  }

  /**
   * Latest snapshot of any source, diffed against the most recent
   * cron-source snapshot strictly older than the current snapshot.
   */
  async getLatestDigest(
    limit = DIGEST_LIMIT_DEFAULT,
  ): Promise<SlowQueryDigestDto | null> {
    const current = await this.findLatestSnapshot();
    if (!current) return null;
    const baseline = await this.findBaselineForCron(current.capturedAt);
    const [currentEntries, baselineEntries] = await Promise.all([
      this.loadEntries(current.id),
      baseline ? this.loadEntries(baseline.id) : Promise.resolve([]),
    ]);
    const diffed = diffEntries(currentEntries, baselineEntries);
    return {
      snapshot: this.toSnapshotDto(current),
      baseline: baseline ? this.toSnapshotDto(baseline) : null,
      entries: diffed.slice(0, limit),
    };
  }

  /** Delete snapshots older than `daysToKeep` (cascades to entries). */
  async pruneOldSnapshots(daysToKeep = PRUNE_DAYS_DEFAULT): Promise<number> {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const deletedRows = await this.db
      .delete(schema.slowQuerySnapshots)
      .where(lt(schema.slowQuerySnapshots.capturedAt, cutoff))
      .returning({ id: schema.slowQuerySnapshots.id });
    if (deletedRows.length > 0) {
      this.logger.log(
        `Pruned ${deletedRows.length} slow-query snapshots older than ${daysToKeep}d`,
      );
    }
    return deletedRows.length;
  }

  // ─── Private helpers (≤30 lines each) ────────────────────────────

  /** Issue the pg_stat_statements query; returns [] when extension absent. */
  private async readPgStatStatements(): Promise<SlowQueryEntryRecord[]> {
    try {
      const rows = await this.db.execute<RawPgStatStatementsRow>(
        selectPgStatStatementsSql(SNAPSHOT_TOP_N),
      );
      return rows.map(normalizeRawRow);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `pg_stat_statements unavailable (${msg}); recording empty snapshot`,
      );
      return [];
    }
  }

  /** Insert one row into slow_query_snapshots. */
  private async insertSnapshotRow(source: SourceDto) {
    const [row] = await this.db
      .insert(schema.slowQuerySnapshots)
      .values({ source })
      .returning();
    return row;
  }

  /** Bulk-insert entries for a snapshot. */
  private async insertEntries(
    snapshotId: number,
    entries: SlowQueryEntryRecord[],
  ): Promise<void> {
    const values = entries.map((e) => ({
      snapshotId,
      queryid: BigInt(e.queryid),
      queryText: e.queryText,
      calls: BigInt(Math.trunc(e.calls)),
      meanExecTimeMs: e.meanExecTimeMs,
      totalExecTimeMs: e.totalExecTimeMs,
    }));
    await this.db.insert(schema.slowQuerySnapshotEntries).values(values);
  }

  /** Most recent snapshot row of any source, or null. */
  private async findLatestSnapshot() {
    const [row] = await this.db
      .select()
      .from(schema.slowQuerySnapshots)
      .orderBy(desc(schema.slowQuerySnapshots.capturedAt))
      .limit(1);
    return row ?? null;
  }

  /** Most recent cron snapshot strictly older than `before`. */
  private async findBaselineForCron(before: Date) {
    const [row] = await this.db
      .select()
      .from(schema.slowQuerySnapshots)
      .where(
        and(
          eq(schema.slowQuerySnapshots.source, 'cron'),
          lt(schema.slowQuerySnapshots.capturedAt, before),
        ),
      )
      .orderBy(desc(schema.slowQuerySnapshots.capturedAt))
      .limit(1);
    return row ?? null;
  }

  /** Load entries for a snapshot, normalised to contract shape. */
  private async loadEntries(
    snapshotId: number,
  ): Promise<SlowQueryEntryRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.slowQuerySnapshotEntries)
      .where(eq(schema.slowQuerySnapshotEntries.snapshotId, snapshotId));
    return rows.map((r) => ({
      queryid: r.queryid.toString(),
      queryText: r.queryText,
      calls: Number(r.calls),
      meanExecTimeMs: r.meanExecTimeMs,
      totalExecTimeMs: r.totalExecTimeMs,
    }));
  }

  /** Map a snapshot row to its contract DTO. */
  private toSnapshotDto(
    row: typeof schema.slowQuerySnapshots.$inferSelect,
  ): SlowQuerySnapshotDto {
    return {
      id: row.id,
      capturedAt: row.capturedAt.toISOString(),
      source: row.source as SourceDto,
    };
  }
}
