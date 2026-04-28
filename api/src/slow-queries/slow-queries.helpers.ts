/**
 * Pure helpers for the slow-query log writer (ROK-1156).
 *
 * Kept separate from `slow-queries.service.ts` so the orchestration code stays
 * under the 300-line file budget and the formatting logic has a tiny unit-test
 * surface.
 */
import { sql, type SQL } from 'drizzle-orm';

/** Max characters of `query` text persisted per entry (long statements get truncated). */
export const QUERY_TEXT_MAX_CHARS = 1024;

/** Hourly digest size — top N statements emitted into each log block. */
export const DIGEST_TOP_N = 10;

/** Top-N statement record sourced from `pg_stat_statements`. */
export interface SlowQueryEntryRecord {
  queryid: string;
  queryText: string;
  calls: number;
  meanExecTimeMs: number;
  totalExecTimeMs: number;
}

/** Raw row shape returned by `selectPgStatStatementsSql()`. */
export type RawPgStatStatementsRow = {
  queryid: string;
  query_text: string;
  calls: string | number;
  mean_exec_time_ms: string | number;
  total_exec_time_ms: string | number;
} & Record<string, unknown>;

/**
 * Drizzle SQL: top-N statements from `pg_stat_statements` in the current
 * database, filtering out catalog/extension/transaction-control noise.
 *
 * Belt-and-braces: `track_utility=off` would also drop COMMIT/BEGIN, but we
 * don't want to globally disable utility tracking.
 */
export function selectPgStatStatementsSql(limit = DIGEST_TOP_N): SQL {
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
 * Normalize a raw row from `pg_stat_statements` into a typed record.
 * Keeps the casts in one place so the service does not duplicate them.
 */
export function normalizeRawRow(
  row: RawPgStatStatementsRow,
): SlowQueryEntryRecord {
  return {
    queryid: String(row.queryid),
    queryText: row.query_text,
    calls: Number(row.calls),
    meanExecTimeMs: Number(row.mean_exec_time_ms),
    totalExecTimeMs: Number(row.total_exec_time_ms),
  };
}

/**
 * Render a slow-query digest as a human-readable block suitable for appending
 * to `slow-queries.log`. Operators read these blocks directly in the admin
 * Logs panel; the format is intentionally fixed-width (not JSON).
 */
export function formatDigestBlock(
  entries: SlowQueryEntryRecord[],
  capturedAt: Date = new Date(),
): string {
  const ts = capturedAt.toISOString();
  const header = `=== Slow Query Digest @ ${ts} ===`;
  const subtitle = `top ${DIGEST_TOP_N} by mean_exec_time (filtered: pg_catalog, information_schema, BEGIN, COMMIT)`;
  const footer = '=== End ===';
  if (entries.length === 0) {
    return [
      header,
      subtitle,
      '(no statements crossed the filter)',
      footer,
      '',
    ].join('\n');
  }
  const columnHeader = formatRow('calls', 'mean_ms', 'total_ms', 'query');
  const rows = entries.map((e) =>
    formatRow(
      String(e.calls),
      e.meanExecTimeMs.toFixed(2),
      e.totalExecTimeMs.toFixed(2),
      collapseQueryWhitespace(e.queryText),
    ),
  );
  return [header, subtitle, columnHeader, ...rows, footer, ''].join('\n');
}

/** Single row of the digest table — fixed-width columns + free-form query tail. */
function formatRow(
  calls: string,
  meanMs: string,
  totalMs: string,
  query: string,
): string {
  return `${calls.padStart(8)}  ${meanMs.padStart(10)}  ${totalMs.padStart(12)}  ${query}`;
}

/** Flatten multi-line statements to a single line so the table stays scannable. */
function collapseQueryWhitespace(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}
