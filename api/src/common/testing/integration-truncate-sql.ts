/**
 * SQL builder for `truncateAllTables` (ROK-2196 option C).
 *
 * The old reset issued one `DELETE` round trip per table (~156 per call,
 * ~40 ms). This builds ONE `DO` block that discovers the tables server-side
 * and deletes them in a loop, so a reset is a single statement.
 *
 * Why the table list is discovered inside the block rather than cached in
 * the process: several integration specs create or drop tables (backup
 * restore, migration repair). A cached list would then DELETE from a table
 * that no longer exists (aborting the whole reset) or skip one that was just
 * created. Server-side discovery costs nothing extra and cannot go stale.
 *
 * Why DELETE and not TRUNCATE: TRUNCATE takes ACCESS EXCLUSIVE locks that
 * deadlock with live request/cron handlers (see INVESTIGATION-2196 row C).
 *
 * `session_replication_role` is set with `set_config(…, true)`, i.e. local to
 * the transaction, so a failure part-way cannot leave a pooled connection in
 * replica mode (FK triggers off).
 */

/** Tables that must survive a reset (seeded at app boot, used by cron). */
export const TRUNCATE_EXCLUDED_TABLES: readonly string[] = [
  'cron_jobs',
  'cron_job_executions',
];

/** `LIKE` pattern for Drizzle's migration bookkeeping tables. */
export const TRUNCATE_EXCLUDED_TABLE_PATTERN = '__drizzle%';

const DOLLAR_TAG = '$rl_truncate$';

/** Render `value` as a single-quoted SQL string literal. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function assertNoDollarTag(values: readonly string[]): void {
  for (const v of values) {
    if (v.includes(DOLLAR_TAG)) {
      throw new Error(`Exclusion "${v}" contains the dollar-quote tag`);
    }
  }
}

/**
 * Build the single-statement reset: one `DO` block that DELETEs every row
 * from every `public` table except the excluded ones, with FK triggers
 * disabled for the duration of the enclosing transaction.
 */
export function buildTruncateSql(
  excluded: readonly string[] = TRUNCATE_EXCLUDED_TABLES,
  excludedPattern: string = TRUNCATE_EXCLUDED_TABLE_PATTERN,
): string {
  assertNoDollarTag([...excluded, excludedPattern]);
  const notIn =
    excluded.length > 0
      ? `\n      AND tablename NOT IN (${excluded.map(sqlStringLiteral).join(', ')})`
      : '';
  return `DO ${DOLLAR_TAG}
DECLARE r record;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE ${sqlStringLiteral(excludedPattern)}${notIn}
  LOOP
    EXECUTE format('DELETE FROM public.%I', r.tablename);
  END LOOP;
  PERFORM set_config('session_replication_role', 'origin', true);
END
${DOLLAR_TAG}`;
}
