import {
  TRUNCATE_EXCLUDED_TABLES,
  TRUNCATE_EXCLUDED_TABLE_PATTERN,
  buildTruncateSql,
  sqlStringLiteral,
} from './integration-truncate-sql';

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('buildTruncateSql (ROK-2196 option C)', () => {
  const block = buildTruncateSql();

  it('is ONE DO statement (one round trip, no per-table client loop)', () => {
    expect(block.trimStart().startsWith('DO $rl_truncate$')).toBe(true);
    expect(block.trimEnd().endsWith('$rl_truncate$')).toBe(true);
    expect(count(block, '$rl_truncate$')).toBe(2);
  });

  it('discovers public tables server-side and keeps the same exclusions', () => {
    expect(block).toContain("WHERE schemaname = 'public'");
    expect(block).toContain("tablename NOT LIKE '__drizzle%'");
    expect(block).toContain(
      "tablename NOT IN ('cron_jobs', 'cron_job_executions')",
    );
    expect(TRUNCATE_EXCLUDED_TABLE_PATTERN).toBe('__drizzle%');
    expect([...TRUNCATE_EXCLUDED_TABLES]).toEqual([
      'cron_jobs',
      'cron_job_executions',
    ]);
  });

  it('DELETEs (never TRUNCATEs) with a server-quoted identifier', () => {
    expect(block).toContain(
      "EXECUTE format('DELETE FROM public.%I', r.tablename)",
    );
    expect(block).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('sets replica mode transaction-locally, then restores origin', () => {
    const replica = block.indexOf(
      "set_config('session_replication_role', 'replica', true)",
    );
    const del = block.indexOf('DELETE FROM');
    const origin = block.indexOf(
      "set_config('session_replication_role', 'origin', true)",
    );
    expect(replica).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(replica);
    expect(origin).toBeGreaterThan(del);
    // A session-wide SET would outlive a failed transaction on a pooled conn.
    expect(block).not.toMatch(/\bSET\s+session_replication_role/i);
  });

  it('escapes exclusion literals so a quote cannot break out', () => {
    const custom = buildTruncateSql(["o'brien", 'plain'], 'x\\_%');
    expect(custom).toContain("tablename NOT IN ('o''brien', 'plain')");
    expect(custom).toContain("tablename NOT LIKE 'x\\_%'");
  });

  it('omits the NOT IN clause for an empty exclusion list', () => {
    const custom = buildTruncateSql([], '__drizzle%');
    expect(custom).not.toContain('NOT IN');
    expect(custom).toContain("tablename NOT LIKE '__drizzle%'");
  });

  it('rejects input that would terminate the dollar-quoted body', () => {
    expect(() => buildTruncateSql(['a$rl_truncate$b'], '__drizzle%')).toThrow(
      /dollar-quote tag/,
    );
  });
});

describe('sqlStringLiteral', () => {
  it('doubles single quotes', () => {
    expect(sqlStringLiteral("it's")).toBe("'it''s'");
  });
});
