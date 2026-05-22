// ROK-1338 PR-2 — rl_db_query: read-only one-shot SQL via env-psql.
//
// Closes the last legitimate agent SSH path (`ssh ... env-psql <slug>`
// interactive psql) with a hardened MCP surface. Read-only by default —
// write mode is NOT shipped in v1; when needed it gets its own MCP tool
// with its own threat model.
//
// SAFETY MODEL (architect-locked + dogfood-corrected):
//
// The architect-locked design originally pinned PGOPTIONS as the primary
// "chokepoint" — but independent dogfood (2026-05-22) proved env-psql does
// `exec docker exec -i $PG ... "$@"` with NO `-e` flag, so the SSH-side
// PGOPTIONS environment never reaches the container. statement_timeout
// stayed at 0 (queries ran 10+ seconds); default_transaction_read_only
// stayed at 'off' at session level. PGOPTIONS was dead defence. Replaced
// with SET LOCAL inside the explicit transaction (which DOES bind to the
// running txn). The real layered defence is:
//
//   1. BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s';
//      ...; ROLLBACK; wrapper — **THE** read-only + timeout chokepoint.
//      SET LOCAL is bound to the current explicit transaction; both ON_ERROR_STOP
//      and ROLLBACK ensure we never escape it.
//   2. FORBIDDEN_KEYWORDS pre-check — string-rejects known knobs that
//      could flip the read-only GUC. Surface-level pre-filter; NOT the
//      primary defender. Catches plain-text attempts (`SET default_transaction_read_only`,
//      `SET SESSION AUTHORIZATION`, `RESET ALL`, `\connect`, and the
//      `set_config(...)` function family that string-concat bypass uses).
//   3. SELECT * FROM (<user-sql>) AS rl_user_query LIMIT 1001 —
//      forces user input to be a single SELECT-able expression at the
//      SQL-syntax layer; semicolons + DDL + BEGIN/COMMIT inside the subquery
//      are syntax errors at the Postgres parser. Doubles as the row-limit.
//   4. `-v ON_ERROR_STOP=1` — psql aborts on first error instead of
//      running subsequent statements with relaxed state.
//   5. `-q` (--quiet) — suppresses BEGIN/SET/ROLLBACK command-tag echoes
//      that would otherwise poison CSV parsing (dogfood-found).
//
// NULL sentinel: we use an unguessable opaque marker (`__RL_NULL_e8f3a4__`)
// rather than psql's default `\N` because real data CAN contain the 2-char
// `\N` literal (verified — `SELECT E'\\N'` round-tripped as null under the
// `\N` sentinel, silent data corruption). The opaque marker can't collide.
//
// NO `worktree_path` param — interactive read-only-by-default query tool,
// no Mutagen sync needed. Consistent with PR-1 rl_task_inspect /
// rl_infra_logs. Intentional omission. Executor REJECTS unknown keys
// (defense in depth — the MCP SDK strips at boundary, but direct callers
// like tests + dogfood scripts also get the strict treatment).

import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { execFileP, shellQuote, synthesizeEmptyStderrDiagnostic } from '../exec.js';

export const TOOL_NAME = 'rl_db_query';
export const TOOL_DESCRIPTION =
  'Run a one-shot read-only SQL query against a fleet env Postgres via env-psql. Defends against writes/DDL via BEGIN/SET TRANSACTION READ ONLY/ROLLBACK wrapper + SET LOCAL statement_timeout=5s + FORBIDDEN_KEYWORDS pre-check + subquery LIMIT 1001 wrap + ON_ERROR_STOP. Returns rows as [{col: val,...}] parsed from CSV with opaque-marker NULL sentinel (NULL distinguishable from empty string AND from literal `\\N` data). Caps at 1000 rows (truncated:true flag). v1 is read_only:true only — write-mode is a separate future tool.';

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
export const DbQueryParamsSchema = z
  .object({
    slug: slugSchema,
    sql: z.string().min(1).max(10000),
    read_only: z.literal(true).optional().default(true),
  })
  .strict(); // dogfood #4 — reject unknown keys at executor boundary
const ALLOWED_PARAM_KEYS = new Set(['slug', 'sql', 'read_only']);

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
// Dogfood #2: validator showed `set_config('default'||'_transaction_read_only', 'off', false)`
// bypasses a regex looking for the literal token. Block the `set_config(` function
// family entirely — no legitimate read-only query needs to MUTATE a GUC, only read.
// `current_setting()` remains allowed (read-only).
const FORBIDDEN_KEYWORDS: RegExp[] = [
  /default_transaction_read_only/i,
  /set\s+session\s+authorization/i,
  /reset\s+all/i,
  /\\connect/i,
  /\bset_config\s*\(/i,
  /\bpg_catalog\.set_config\s*\(/i,
];

// Dogfood #3: psql's default `\N` NULL sentinel collides with real data
// (`SELECT E'\\N'` round-trips as null under `-P null=\N`). Use an
// opaque hex-tagged marker that cannot occur in legitimate data unless
// someone is actively trying to spoof — and even then the parser only
// converts it to null when csv-parse reports the cell was UNQUOTED in
// the source CSV (which a real cell containing this string would never be).
export const NULL_SENTINEL = '__RL_NULL_e8f3a4__';

/**
 * Build the hardened remote command. The `params.sql` has been pre-stripped
 * of trailing semicolons. All defense layers assembled here in one place.
 *
 * Dogfood #1 fix: PGOPTIONS env var does NOT propagate through env-psql's
 * `docker exec` boundary (no `-e` flag), so PGOPTIONS-set statement_timeout
 * stayed at 0 in practice. Replaced with `SET LOCAL statement_timeout='5s'`
 * INSIDE the explicit transaction — SET LOCAL is txn-scoped, ROLLBACK ends
 * it, and ON_ERROR_STOP guarantees we never leave the SET LOCAL state.
 */
function buildRemoteCommand(slug: string, sql: string): string {
  const stripped = sql.trim().replace(/;\s*$/, '');
  const wrappedSql =
    `BEGIN; ` +
    `SET TRANSACTION READ ONLY; ` +
    `SET LOCAL statement_timeout = '5s'; ` +
    `SELECT * FROM (${stripped}) AS rl_user_query LIMIT ${FETCH_LIMIT}; ` +
    `ROLLBACK;`;
  // `-P null=<sentinel>`: psql emits this literal string for NULL cells in
  // CSV output. csv-parse then maps unquoted occurrences back to JS null.
  // The opaque sentinel can't collide with real data (cf. dogfood #3).
  //
  // `-q` (--quiet) suppresses the command-tag echoes that psql writes to
  // stdout when running BEGIN / SET / ROLLBACK statements. Without -q, the
  // multi-statement -c string sends `BEGIN\nSET\n<csv-header>\n<csv-row>\nROLLBACK`
  // to stdout — the CSV parser then treats `BEGIN` as the header row.
  return (
    `/srv/rl-infra/orchestrator/bin/env-psql ${shellQuote(slug)} -- ` +
    `--csv -q -v ON_ERROR_STOP=1 -P ${shellQuote(`null=${NULL_SENTINEL}`)} ` +
    `--set=FETCH_COUNT=${FETCH_LIMIT} ` +
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
      // Only treat the sentinel as NULL when csv-parse reports the source
      // cell was UNQUOTED (i.e. psql emitted it from a real NULL, not a
      // user data row that happens to contain the same string). Even with
      // the opaque marker this guards against an attacker-spoofed row.
      if (!ctx.quoting && value === NULL_SENTINEL) return null;
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
  // Dogfood #4 — explicit unknown-key reject. The MCP SDK strips unknown
  // keys at its boundary (silent), so a direct executor caller (tests,
  // dogfood scripts, future non-MCP transport) would otherwise also see
  // silent strip. With the strict() schema below, unknown keys here become
  // a structured error envelope instead.
  if (params && typeof params === 'object') {
    for (const k of Object.keys(params)) {
      if (!ALLOWED_PARAM_KEYS.has(k)) {
        return {
          ok: false,
          error: 'unknown_param',
          message: `unknown parameter: ${k}`,
          hint: `rl_db_query accepts only: ${[...ALLOWED_PARAM_KEYS].join(', ')}`,
        };
      }
    }
  }
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
