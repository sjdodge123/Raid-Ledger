/**
 * Pure helpers for the slow-query digest (ROK-1156).
 *
 * Kept separate from `slow-queries.service.ts` so the orchestration code
 * stays under the 300-line file budget and the diff math has a tiny
 * unit-test surface.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Max characters of `query` text persisted per entry (UI truncates anyway). */
export const QUERY_TEXT_MAX_CHARS = 1024;

/**
 * Per-window slow-query record. `queryid` is serialized as a string to match
 * the contract (Postgres bigint, JS Number would lose precision).
 */
export interface SlowQueryEntryRecord {
  queryid: string;
  queryText: string;
  calls: number;
  meanExecTimeMs: number;
  totalExecTimeMs: number;
}

/** Raw row shape returned by `selectPgStatStatements()`. */
export type RawPgStatStatementsRow = {
  queryid: string;
  query_text: string;
  calls: string | number;
  mean_exec_time_ms: string | number;
  total_exec_time_ms: string | number;
} & Record<string, unknown>;

/**
 * Diff two cumulative `pg_stat_statements` snapshots into a per-window delta.
 *
 * - First-snapshot path (empty baseline): pass-through.
 * - Reset detection: if `curr.calls < prev.calls`, treat current as fully
 *   in-window. Without this, a manual `pg_stat_statements_reset()` would
 *   surface as negative call counts.
 * - Filters out entries with zero calls in the window.
 * - Returns descending by `meanExecTimeMs` (slowest first).
 */
export function diffEntries(
  current: SlowQueryEntryRecord[],
  baseline: SlowQueryEntryRecord[],
): SlowQueryEntryRecord[] {
  const baselineByQueryId = new Map(baseline.map((e) => [e.queryid, e]));
  const diffed = current
    .map((curr) => {
      const prev = baselineByQueryId.get(curr.queryid);
      const callsDelta =
        !prev || curr.calls < prev.calls ? curr.calls : curr.calls - prev.calls;
      const totalDelta =
        !prev || curr.totalExecTimeMs < prev.totalExecTimeMs
          ? curr.totalExecTimeMs
          : curr.totalExecTimeMs - prev.totalExecTimeMs;
      const meanInWindow = callsDelta > 0 ? totalDelta / callsDelta : 0;
      return {
        ...curr,
        calls: callsDelta,
        totalExecTimeMs: totalDelta,
        meanExecTimeMs: meanInWindow,
      };
    })
    .filter((e) => e.calls > 0);
  return diffed.sort((a, b) => b.meanExecTimeMs - a.meanExecTimeMs);
}

/**
 * Drizzle SQL: top-N statements from `pg_stat_statements` in the current
 * database, filtering out catalog/extension/transaction-control noise.
 *
 * Belt-and-braces: `track_utility=off` would also drop COMMIT/BEGIN, but we
 * don't want to globally disable utility tracking.
 */
export function selectPgStatStatementsSql(limit = 100): SQL {
  return sql`
    SELECT
      queryid::text                                AS queryid,
      LEFT(query, ${QUERY_TEXT_MAX_CHARS})         AS query_text,
      calls::text                                  AS calls,
      mean_exec_time::text                         AS mean_exec_time_ms,
      total_exec_time::text                        AS total_exec_time_ms
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT LIKE '%pg_catalog%'
      AND query NOT LIKE '%information_schema%'
      AND query NOT LIKE 'COMMIT%'
      AND query NOT LIKE 'BEGIN%'
    ORDER BY mean_exec_time DESC
    LIMIT ${limit}
  `;
}

/**
 * Normalize a raw row from `pg_stat_statements` into a `SlowQueryEntryRecord`.
 * Keeps the casts in one place so the service does not duplicate them.
 */
export function normalizeRawRow(
  row: RawPgStatStatementsRow,
): SlowQueryEntryRecord {
  const calls = Number(row.calls);
  const meanExecTimeMs = Number(row.mean_exec_time_ms);
  const totalExecTimeMs = Number(row.total_exec_time_ms);
  return {
    queryid: String(row.queryid),
    queryText: row.query_text,
    calls,
    meanExecTimeMs,
    totalExecTimeMs,
  };
}
