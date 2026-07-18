import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { computeNextRun } from './cron-job.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Flush pending last_run_at updates to DB (ROK-1414).
 *
 * On the disk-latency-bound NAS, per-job single-row UPDATEs dominated the
 * ≥100ms app-observed query load — the cost is the per-write commit/fsync
 * roundtrip, not the statement itself. So this issues exactly ONE batched
 * UPDATE per flush cycle covering every pending job (via a `VALUES` join),
 * regardless of how many jobs are queued.
 *
 * Dates are serialised with `toISOString()` and cast to `timestamp` to match
 * drizzle's own `PgTimestamp.mapToDriverValue`, so stored values are identical
 * to the previous per-row path. Every pending entry is already a genuine
 * change (see `queueLivenessIfStale`, which only queues when the value moves
 * and immediately advances the in-memory `lastRunAt`), so no separate
 * unchanged-row skip is needed.
 */
export async function flushPendingUpdates(
  db: Db,
  pending: Map<number, { lastRunAt: Date; cronExpression: string }>,
  logger: Logger,
): Promise<void> {
  if (pending.size === 0) return;
  const updates = new Map(pending);
  pending.clear();
  const rows = buildFlushRows(updates, logger);
  if (rows.length === 0) return;
  try {
    await db.execute(sql`
      UPDATE ${schema.cronJobs} AS c
         SET last_run_at = v.last_run_at, next_run_at = v.next_run_at,
             updated_at = ${new Date().toISOString()}::timestamp
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, last_run_at, next_run_at)
       WHERE c.id = v.id
    `);
  } catch (err) {
    const ids = Array.from(updates.keys()).join(', ');
    logger.warn(`Failed to flush last_run_at for job(s) ${ids}: ${err}`);
    return;
  }
  logger.debug(`Flushed last_run_at for ${rows.length} cron job(s)`);
}

/**
 * Build the `VALUES` tuples for the batched flush, skipping (with a warn) any
 * row that fails to serialise — e.g. an invalid Date whose toISOString()
 * throws. One poisoned entry must cost only its own row, not the whole
 * cycle's updates (the pre-ROK-1414 per-row loop had the same property).
 */
function buildFlushRows(
  updates: Map<number, { lastRunAt: Date; cronExpression: string }>,
  logger: Logger,
) {
  const rows = [];
  const failed: number[] = [];
  for (const [id, { lastRunAt, cronExpression }] of updates) {
    try {
      rows.push(flushValuesRow(id, lastRunAt, cronExpression));
    } catch {
      failed.push(id);
    }
  }
  if (failed.length > 0) {
    logger.warn(
      `Skipped unserialisable last_run_at row(s) for job(s) ${failed.join(', ')}`,
    );
  }
  return rows;
}

/** Build one `VALUES` tuple (id, last_run_at, next_run_at) for the batched flush. */
function flushValuesRow(id: number, lastRunAt: Date, cronExpression: string) {
  const nextRunAt = computeNextRun(cronExpression);
  return sql`(${id}::int, ${lastRunAt.toISOString()}::timestamp, ${
    nextRunAt ? nextRunAt.toISOString() : null
  }::timestamp)`;
}
