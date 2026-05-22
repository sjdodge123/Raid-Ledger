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
// Output format: psql emits a single text cell containing a JSON array
// produced by `json_agg(row_to_json(t))`. JSON has unambiguous NULL
// (`null` keyword), distinguishable from empty string and from any text
// sentinel — so no sentinel collision class exists by construction. Round
// 2 + round 3 dogfood proved that ANY string-based sentinel (`\N` or
// opaque marker) collides with real data because psql `--csv` only quotes
// values containing the delimiter / quote char / newline; plain-ASCII
// values emit unquoted and the cast hook eats them. JSON sidesteps the
// problem entirely.
//
// NO `worktree_path` param — interactive read-only-by-default query tool,
// no Mutagen sync needed. Consistent with PR-1 rl_task_inspect /
// rl_infra_logs. Intentional omission. Executor REJECTS unknown keys
// (defense in depth — the MCP SDK strips at boundary, but direct callers
// like tests + dogfood scripts also get the strict treatment).

import { z } from 'zod';
// Round-4 #2 — JSON.parse clips integers > 2^53 to JS Number precision,
// silently corrupting bigserial PKs / large counters. json-bigint with
// `storeAsString:true` returns those values as strings (consumers can
// `BigInt(s)` for arithmetic OR string-compare for IDs) while regular
// safe integers stay as JS Number. Tiny dep, no native code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import JSONbigFactory from 'json-bigint';
const JSONbig = JSONbigFactory({ storeAsString: true });
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
  /**
   * Row objects with column names as keys. Values are JSON-native types
   * (null, string, number, boolean, object, array) as produced by
   * `row_to_json` server-side. Postgres NULL → JS null; numerics → JS
   * number (bigint > 2^53 risks precision loss — same as any JSON-over-
   * the-wire shape); text → string.
   */
  rows?: Array<Record<string, unknown>>;
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
// String-matched (case-insensitive) BEFORE the SQL ever reaches psql, so the
// blocked attempt costs no network round-trip and produces a clear error
// envelope. The keyword set targets the only known knobs that flip read-only
// enforcement mid-session.
//
// Round-3 dogfood narrowed the `default_transaction_read_only` matcher: it
// used to fire on ANY mention of the string (including `SELECT
// current_setting('default_transaction_read_only')`, which is a legitimate
// read). Now it only matches the SET / SET LOCAL assignment form.
// Equivalent narrowing on the other GUC-flip strings would be welcome but
// they have no read-form ambiguity today.
//
// Round-2 dogfood added the `set_config()` function family to block the
// `set_config('default'||'_transaction_read_only', ...)` string-concat
// bypass. `current_setting()` (read-only counterpart) is NOT blocked.
const FORBIDDEN_KEYWORDS: RegExp[] = [
  /\bset\s+(local\s+)?default_transaction_read_only\b/i,
  /\bset\s+session\s+authorization\b/i,
  /\breset\s+all\b/i,
  /\\connect/i,
  /\bset_config\s*\(/i,
  /\bpg_catalog\.set_config\s*\(/i,
];

/**
 * Build the hardened remote command. The `params.sql` has been pre-stripped
 * of trailing semicolons. All defense layers assembled here in one place.
 *
 * Layers:
 *   1. BEGIN; SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='5s'
 *      — the actual read-only + timeout chokepoint. SET LOCAL is bound to
 *      the current explicit transaction; ROLLBACK ends it cleanly.
 *   2. SELECT * FROM (<user-sql>) AS rl_inner LIMIT 1001 — forces a single
 *      SELECT-able expression at the SQL-syntax layer (semicolons, DDL,
 *      multi-statement reject as Postgres syntax errors).
 *   3. SELECT json_agg(row_to_json(t)) wrap — output is one text cell
 *      with a JSON array. NULL is `null` (unambiguous), no sentinel-vs-
 *      data collision possible (round-3 dogfood proved string sentinels
 *      ALWAYS collide because psql `--csv` only quotes values with
 *      delimiter / quote / newline chars).
 *   4. COALESCE(..., '[]') — empty result is `[]`, not psql's empty-cell.
 */
function buildRemoteCommand(slug: string, sql: string): string {
  const stripped = sql.trim().replace(/;\s*$/, '');
  // The user's SQL goes inside a sub-subquery so the LIMIT applies BEFORE
  // json_agg builds the array (bounded memory). The outer COALESCE handles
  // the zero-row case (json_agg returns NULL → we want `[]`).
  //
  // Round-4 #1 — the outer table alias used to be `t`. If a user query
  // SELECTed a column AS `t`, Postgres preferred the column reference over
  // the table reference inside `row_to_json(t)` and resolved as
  // `row_to_json(<col_type>)` (no such overload) — db_query_failed for the
  // common `SELECT ... AS t FROM ...` idiom. Renamed to a `__rl_`-prefixed
  // alias that's extremely unlikely to collide with a user column name.
  const wrappedSql =
    `BEGIN; ` +
    `SET TRANSACTION READ ONLY; ` +
    `SET LOCAL statement_timeout = '5s'; ` +
    `SELECT COALESCE(json_agg(row_to_json(__rl_q_row__)), '[]'::json)::text ` +
    `FROM (SELECT * FROM (${stripped}) AS rl_inner LIMIT ${FETCH_LIMIT}) AS __rl_q_row__; ` +
    `ROLLBACK;`;
  // `-A -t` (unaligned + tuples-only) emits just the cell value — no
  // header, no padding. For our single-row, single-cell SELECT, that's
  // exactly the JSON text we want to parse.
  //
  // `-q` (--quiet) suppresses the BEGIN / SET / ROLLBACK command-tag echo
  // that would otherwise prepend `BEGIN\nSET\n...` to our JSON cell.
  //
  // No `-P null=...` needed — JSON is the canonical null encoding now.
  // No `--csv` — we use tuples-only text output.
  return (
    `/srv/rl-infra/orchestrator/bin/env-psql ${shellQuote(slug)} -- ` +
    `-A -t -q -v ON_ERROR_STOP=1 ` +
    `-c ${shellQuote(wrappedSql)}`
  );
}

/**
 * Parse the JSON-array stdout from `json_agg(row_to_json(t))`. Returns
 * `{columns, rows}` where columns are derived from the first row's object
 * keys (which preserve SELECT column order via row_to_json's contract).
 *
 * Postgres + JSON guarantee unambiguous NULLs — no sentinel parsing, no
 * quote-vs-not heuristics. A cell that's literally the string `"null"`
 * arrives as JSON `"null"` (quoted); a real SQL NULL arrives as JSON `null`
 * (no quotes). JSON.parse handles the distinction.
 */
function parseJsonResponse(
  stdout: string,
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return { columns: [], rows: [] };
  let parsed: unknown;
  try {
    // Round-4 #2 — JSONbig (with storeAsString:true) preserves bigint /
    // large-numeric values as JS strings instead of clipping to Number
    // precision. Safe integers (|n| <= 2^53) stay as JS Number.
    parsed = JSONbig.parse(trimmed);
  } catch (e) {
    throw new Error(
      `failed to parse json from psql stdout: ${(e as Error).message}; ` +
        `first 200 chars: ${trimmed.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `expected JSON array from json_agg, got ${typeof parsed}: ${trimmed.slice(0, 200)}`,
    );
  }
  const rows = parsed as Array<Record<string, unknown>>;
  // row_to_json preserves SELECT column order — Object.keys on the first
  // row's object gives us that order back. Empty result → empty columns.
  const columns = rows.length > 0 && rows[0] && typeof rows[0] === 'object'
    ? Object.keys(rows[0])
    : [];
  return { columns, rows };
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
  // BEGIN/SET TRANSACTION READ ONLY catches smuggled writes. Pattern matches
  // any "cannot execute X in a read-only transaction" message Postgres emits.
  //
  // Round-4 #4 — verb whitelist was too narrow (caught DML/DDL keywords but
  // missed function-form writes like `nextval()`, `setval()`, `pg_advisory_lock()`).
  // Broadened to any token + optional parens before the read-only-transaction
  // suffix. Postgres's actual error text is `cannot execute X in a read-only
  // transaction` where X is the statement / function name.
  if (
    /cannot execute [\w()*]+\b.*read-only transaction/i.test(stderr)
  ) {
    return {
      ok: false,
      slug,
      error: 'read_only_violation',
      message: stderr.trim(),
      hint:
        'rl_db_query enforces read-only. Detected an attempt to write via DML/DDL/ ' +
        'side-effecting function — the BEGIN/SET TRANSACTION READ ONLY wrapper rejected it.',
    };
  }
  // statement_timeout (5s) from SET LOCAL inside the read-only transaction.
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
    let columns: string[];
    let rows: Array<Record<string, unknown>>;
    try {
      const parsed = parseJsonResponse(stdout);
      columns = parsed.columns;
      rows = parsed.rows;
    } catch (parseErr) {
      return {
        ok: false,
        slug,
        error: 'db_query_failed',
        message: (parseErr as Error).message,
        hint: 'psql produced output that was not parseable as the expected JSON array.',
      };
    }
    const truncated = rows.length >= FETCH_LIMIT;
    const kept = truncated ? rows.slice(0, ROW_LIMIT) : rows;
    return {
      ok: true,
      slug,
      columns,
      // Cast the row shape from Record<string, unknown> → DbQueryResult's
      // narrower row type. JSON values are JS-native (null|string|number|
      // boolean|object|array); the public type widens to `unknown` so
      // consumers branch on actual value type.
      rows: kept as Array<Record<string, unknown>>,
      row_count: kept.length,
      truncated,
      elapsed_ms: Date.now() - startMs,
    };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number | string };
    // Round-4 #3 — maxBuffer overflow used to fall through to the generic
    // "empty stderr → synth diagnostic" path with an unhelpful "command not
    // found / shell init failure" hint. Detect the specific Node code +
    // surface a structured `response_too_large` envelope BEFORE the generic
    // classifier sees it.
    if (
      e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
      /maxBuffer/i.test(e.message)
    ) {
      return {
        ok: false,
        slug,
        error: 'response_too_large',
        message: 'psql output exceeded the 16MB stdout cap.',
        hint:
          'The JSON-serialized result set is larger than 16MB. Narrow the SELECT to fewer ' +
          'columns, add a more selective WHERE clause, or rely on the built-in LIMIT 1001 ' +
          '(some single rows can still be megabytes if they include large text/jsonb fields).',
      };
    }
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(
            typeof e.code === 'number' ? e.code : undefined,
          )
        : e.stderr;
    return classifyError(slug, e.code, stderr);
  }
}
