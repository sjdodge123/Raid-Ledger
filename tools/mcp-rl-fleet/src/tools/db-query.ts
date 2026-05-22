// ROK-1338 PR-2 — rl_db_query: read-only one-shot SQL via env-psql.
//
// Closes the last legitimate agent SSH path (`ssh ... env-psql <slug>`
// interactive psql) with a hardened MCP surface. Read-only by default —
// write mode is NOT shipped in v1; when needed it gets its own MCP tool
// with its own threat model.
//
// SAFETY MODEL (architect-locked, planning-artifacts/architect-ROK-1338-pr2.md
// §"Belt-and-suspenders defence layers"):
//
//   1. PGOPTIONS connect-time GUC (the chokepoint) —
//      `-c default_transaction_read_only=on -c statement_timeout=5000`
//      makes EVERY implicit/explicit transaction read-only by default.
//      `SET LOCAL` mid-session cannot unset GUCs received via PGOPTIONS.
//   2. BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK; wrapper —
//      redundant defence + keeps logs readable.
//   3. FORBIDDEN_KEYWORDS pre-check — string-rejects the four known knobs
//      that flip the GUC mid-session (default_transaction_read_only,
//      SET SESSION AUTHORIZATION, RESET ALL, \connect).
//   4. SELECT * FROM (<user-sql>) AS rl_user_query LIMIT 1001 —
//      forces user input to be a single SELECT-able expression at the
//      SQL-syntax layer; doubles as the row-limit (truncate to 1000).
//   5. `-v ON_ERROR_STOP=1` — psql aborts on first error instead of
//      running subsequent statements with relaxed state.
//
// NO `worktree_path` param — interactive read-only-by-default query tool,
// no Mutagen sync needed. Consistent with PR-1 rl_task_inspect /
// rl_infra_logs. Intentional omission, do not add for parity.

import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { execFileP, shellQuote, synthesizeEmptyStderrDiagnostic } from '../exec.js';

export const TOOL_NAME = 'rl_db_query';
export const TOOL_DESCRIPTION =
  'Run a one-shot read-only SQL query against a fleet env Postgres via env-psql. Defends against write-attempts and DDL via PGOPTIONS GUC + transaction wrapper + subquery wrap + ON_ERROR_STOP. Returns rows as [{col: val,...}] parsed from CSV. NULL distinguishable from empty string. Caps at 1000 rows (truncated:true flag). 5s statement timeout. v1 is read_only:true only — write-mode is a separate future tool.';

// ---------------------------------------------------------------------------
// Zod schema (MCP boundary)
// ---------------------------------------------------------------------------

const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9-]+$/, 'slug must match ^[a-z0-9-]+$');

/**
 * `read_only` is hard-coded TRUE in v1. We accept the field at the schema
 * boundary (so callers explicitly passing `read_only: true` aren't rejected),
 * but `false` is refused with a friendly error. When/if write-mode is needed,
 * it gets its OWN MCP tool with its own threat model — keep this surface
 * narrow.
 */
export const DbQueryParamsSchema = z.object({
  slug: slugSchema,
  sql: z.string().min(1).max(10000),
  read_only: z.literal(true).optional().default(true),
});

export type DbQueryParams = z.infer<typeof DbQueryParamsSchema>;

export interface DbQueryResult {
  ok: boolean;
  slug?: string;
  rows?: Array<Record<string, string | null>>;
  columns?: string[];
  row_count?: number;
  truncated?: boolean;
  elapsed_ms?: number;
  error?: string;
  message?: string;
  hint?: string;
}

const sshUser = (): string => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = (): string => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

const ROW_LIMIT = 1000; // hard cap returned to caller
const FETCH_LIMIT = ROW_LIMIT + 1; // 1001 — the truncation sentinel

// ---------------------------------------------------------------------------
// FORBIDDEN_KEYWORDS (architect §D layer 3)
// ---------------------------------------------------------------------------
//
// The four known knobs that flip the PGOPTIONS-set read-only GUC mid-session.
// String-matched (case-insensitive) BEFORE the SQL ever reaches psql, so the
// blocked attempt costs no network round-trip and produces a clear error
// envelope. False-positive risk minimal — no legitimate read-only query
// needs to mention these tokens.
const FORBIDDEN_KEYWORDS: RegExp[] = [
  /default_transaction_read_only/i,
  /set\s+session\s+authorization/i,
  /reset\s+all/i,
  /\\connect/i,
];

/**
 * Build the architect-locked hardened remote command. The `params.sql` has
 * been pre-stripped of trailing semicolons. All layers (PGOPTIONS, subquery
 * wrap, psql flags) assembled here in one place for auditability.
 */
function buildRemoteCommand(slug: string, sql: string): string {
  const stripped = sql.trim().replace(/;\s*$/, '');
  const wrappedSql =
    `BEGIN; SET TRANSACTION READ ONLY; ` +
    `SELECT * FROM (${stripped}) AS rl_user_query LIMIT ${FETCH_LIMIT}; ` +
    `ROLLBACK;`;
  // `-P null=\\\\N`: in JS string `\\\\N` is the 4-char sequence `\\N`,
  // which the SSH shell collapses to `\N`, which psql reads as the NULL
  // sentinel. The CSV parser then maps unquoted `\N` to JS null.
  return (
    `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000' ` +
    `/srv/rl-infra/orchestrator/bin/env-psql ${shellQuote(slug)} -- ` +
    `--csv -v ON_ERROR_STOP=1 -P null=\\\\N --set=FETCH_COUNT=${FETCH_LIMIT} ` +
    `-c ${shellQuote(wrappedSql)}`
  );
}

/**
 * Parse psql --csv stdout. Header row → columns[]; data rows →
 * Array<Record<col, val>>. Unquoted `\N` (the NULL sentinel set via
 * `-P null='\N'`) → JS null; quoted values pass through as strings.
 */
function parseCsvResponse(
  stdout: string,
): { columns: string[]; rows: Array<Record<string, string | null>> } {
  const trimmed = stdout.replace(/\r/g, '');
  if (trimmed.length === 0) return { columns: [], rows: [] };
  // csv-parse handles RFC 4180 quoting + embedded newlines correctly.
  // The `cast` hook fires once per cell; `ctx.quoting` is true iff the
  // source cell was wrapped in double-quotes. Unquoted `\N` → null;
  // a literal quoted `"\N"` stays the string `\N`.
  const records = parseCsv(trimmed, {
    columns: true,
    skip_empty_lines: true,
    cast: (value: string, ctx: { quoting: boolean }) => {
      if (!ctx.quoting && value === '\\N') return null;
      return value;
    },
  }) as Array<Record<string, string | null>>;
  // csv-parse's `columns: true` produces objects but doesn't expose the
  // header order directly — re-derive from the first line of the CSV so
  // callers get ordered columns alongside row objects.
  const firstNewline = trimmed.indexOf('\n');
  const headerLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline) : trimmed;
  const columns = parseCsv(headerLine + '\n', {
    columns: false,
    skip_empty_lines: true,
  }) as string[][];
  return {
    columns: columns[0] ?? [],
    rows: records,
  };
}

/**
 * Classify a psql/SSH failure into a structured error envelope. The classifier
 * order matters: more specific patterns (read-only violation, statement
 * timeout) must be tested BEFORE the generic fallbacks (db_unreachable,
 * db_query_failed).
 */
function classifyError(
  slug: string,
  exitCode: number | string | undefined,
  stderr: string,
): DbQueryResult {
  // env-psql exits 3 for missing pg container (`env-psql: pg container '...' not found`).
  if (
    exitCode === 3 &&
    /pg container .* not found/i.test(stderr)
  ) {
    return {
      ok: false,
      slug,
      error: 'env_not_found',
      message: stderr.trim(),
    };
  }
  // PGOPTIONS GUC catches smuggled writes. Pattern matches any DML/DDL
  // rejection in a read-only transaction.
  if (
    /cannot execute (INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|MERGE)\b.*read-only transaction/i.test(
      stderr,
    )
  ) {
    return {
      ok: false,
      slug,
      error: 'read_only_violation',
      message: stderr.trim(),
      hint:
        'rl_db_query enforces read-only. Detected an attempt to write via DML/DDL — ' +
        'the PGOPTIONS connect-time GUC rejected it.',
    };
  }
  // statement_timeout (5s) from PGOPTIONS.
  if (/canceling statement due to statement timeout/i.test(stderr)) {
    return {
      ok: false,
      slug,
      error: 'statement_timeout',
      message: stderr.trim(),
      hint:
        'Query exceeded the 5s statement_timeout. Narrow your WHERE clause or precompute the aggregate.',
    };
  }
  // Postgres syntax errors. Includes the subquery-wrap rejection path —
  // any multi-statement / DDL / BEGIN-COMMIT injection becomes a syntax
  // error inside the subquery.
  if (/ERROR:\s+syntax error/i.test(stderr)) {
    return {
      ok: false,
      slug,
      error: 'syntax_error',
      message: stderr.trim(),
      hint:
        'rl_db_query supports a single SELECT statement (wrapped in a subquery for safety). ' +
        'Multi-statement queries, DDL, and explicit BEGIN/COMMIT/ROLLBACK are rejected.',
    };
  }
  // SSH-level failures (host unreachable, auth refused, etc.) — exitCode
  // 255 is ssh's standard "connection failed" code, but also catch the
  // common "Connection refused" / "connect to host" patterns regardless
  // of code.
  if (
    exitCode === 255 ||
    /ssh:.*connect/i.test(stderr) ||
    /Connection refused/i.test(stderr)
  ) {
    return {
      ok: false,
      slug,
      error: 'db_unreachable',
      message: stderr.trim(),
    };
  }
  return {
    ok: false,
    slug,
    error: 'db_query_failed',
    message: stderr.trim(),
  };
}

/**
 * Execute a read-only SQL query against a fleet env's Postgres. See file
 * header for the safety model. Returns a structured envelope — never throws.
 *
 * @param params - slug + sql + read_only:true (write-mode not in v1).
 */
export async function execute(params: DbQueryParams): Promise<DbQueryResult> {
  // Defense-in-depth: re-validate at the executor boundary. Zod at the MCP
  // layer already guards, but executors don't trust that.
  const validated = DbQueryParamsSchema.safeParse(params);
  if (!validated.success) {
    return {
      ok: false,
      error: 'invalid_params',
      message: validated.error.message,
    };
  }
  const { slug, sql } = validated.data;

  // Layer 3 — FORBIDDEN_KEYWORDS pre-check. The four known knobs that flip
  // the PGOPTIONS read-only GUC mid-session. Cheap, no network cost.
  for (const re of FORBIDDEN_KEYWORDS) {
    if (re.test(sql)) {
      return {
        ok: false,
        slug,
        error: 'blocked_keyword',
        hint: `SQL contains a keyword not permitted in rl_db_query (${re.source})`,
      };
    }
  }

  const remote = buildRemoteCommand(slug, sql);
  const sshArgs = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    `${sshUser()}@${sshHost()}`,
    remote,
  ];

  const startMs = Date.now();
  try {
    const { stdout } = await execFileP('ssh', sshArgs, {
      // 16 MB stdout cap — at 1001 rows × reasonable row sizes this is
      // ample headroom; the subquery LIMIT keeps the actual payload tiny.
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
    const { columns, rows } = parseCsvResponse(stdout);
    const truncated = rows.length >= FETCH_LIMIT;
    const kept = truncated ? rows.slice(0, ROW_LIMIT) : rows;
    return {
      ok: true,
      slug,
      columns,
      rows: kept,
      row_count: kept.length,
      truncated,
      elapsed_ms: Date.now() - startMs,
    };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number | string };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(
            typeof e.code === 'number' ? e.code : undefined,
          )
        : e.stderr;
    return classifyError(slug, e.code, stderr);
  }
}
