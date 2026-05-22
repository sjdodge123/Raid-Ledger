// ROK-1338 PR-2 — rl_db_query tests.
//
// Mirrors task-inspect.spec.ts: vi.mock('node:child_process') stubs the SSH
// exec. Tests target executor behavior — Zod validation, FORBIDDEN_KEYWORDS
// pre-check, subquery wrap, CSV parsing, error classification.
//
// Architect-locked test coverage from planning-artifacts/architect-ROK-1338-pr2.md
// §"Test coverage additions vs spec AC #3":
//   1. ROLLBACK; INSERT ...; BEGIN — caught by PGOPTIONS read-only GUC.
//   2. SELECT 1; CREATE TABLE pwn(y int); — caught by subquery wrap (semicolon).
//   3. SET default_transaction_read_only = off; INSERT ... — blocked_keyword.
//   4. SELECT * FROM users WHERE name = 'O''Brien' — shellQuote round-trips.
//   5. SELECT generate_series(1, 100000) — truncated:true, row_count:1000.
// Plus: happy SELECT, env_not_found, statement_timeout, invalid slug,
// sql > 10000 char rejection, NULL vs empty-string vs literal-"\N", SSH failure.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import { execute, DbQueryParamsSchema } from '../db-query.js';

function execFileOk(stdout: string, stderr = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, stderr);
    },
  );
}

function execFileFail(exitCode: number | string, stderr: string, stdout = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      const err = Object.assign(new Error(stderr), { code: exitCode, stdout, stderr });
      callback(err, stdout, stderr);
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_db_query — DbQueryParamsSchema (Zod boundary)', () => {
  it('accepts a minimal {slug, sql}', () => {
    const parsed = DbQueryParamsSchema.parse({
      slug: 'myslug',
      sql: 'SELECT 1',
    });
    // read_only defaults to true (v1 hard-codes write-mode off).
    expect(parsed.read_only).toBe(true);
  });

  it('rejects read_only:false (v1 only supports read_only:true)', () => {
    expect(() =>
      DbQueryParamsSchema.parse({
        slug: 'myslug',
        sql: 'SELECT 1',
        read_only: false,
      }),
    ).toThrow();
  });

  it('rejects invalid slug shape (uppercase, spaces, dots)', () => {
    expect(() => DbQueryParamsSchema.parse({ slug: 'MY-Slug', sql: 'SELECT 1' })).toThrow();
    expect(() => DbQueryParamsSchema.parse({ slug: 'my slug', sql: 'SELECT 1' })).toThrow();
    expect(() => DbQueryParamsSchema.parse({ slug: 'my.slug', sql: 'SELECT 1' })).toThrow();
  });

  it('rejects empty slug AND slug > 63 chars', () => {
    expect(() => DbQueryParamsSchema.parse({ slug: '', sql: 'SELECT 1' })).toThrow();
    expect(() =>
      DbQueryParamsSchema.parse({ slug: 'a'.repeat(64), sql: 'SELECT 1' }),
    ).toThrow();
  });

  it('rejects empty sql AND sql > 10000 chars', () => {
    expect(() => DbQueryParamsSchema.parse({ slug: 'myslug', sql: '' })).toThrow();
    expect(() =>
      DbQueryParamsSchema.parse({ slug: 'myslug', sql: 'a'.repeat(10001) }),
    ).toThrow();
  });
});

describe('rl_db_query — execute() defense-in-depth', () => {
  it('re-validates slug at executor boundary (no SSH call on bad slug)', async () => {
    const result = await execute({
      slug: 'BAD SLUG',
      sql: 'SELECT 1',
      read_only: true,
    } as unknown as Parameters<typeof execute>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('re-validates sql length at executor boundary', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'a'.repeat(10001),
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_params');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('rl_db_query — FORBIDDEN_KEYWORDS pre-check', () => {
  // Architect §D layer 3 — string-match rejection BEFORE the SQL ever
  // reaches psql. These are the only known knobs that flip the
  // PGOPTIONS-set read-only GUC mid-session.

  it('rejects SET default_transaction_read_only = off (architect case 3)', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'SET default_transaction_read_only = off; INSERT INTO users(id) VALUES (999)',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(result.hint).toMatch(/default_transaction_read_only/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects SET SESSION AUTHORIZATION', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: "SET SESSION AUTHORIZATION 'postgres'; SELECT 1",
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects RESET ALL', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'RESET ALL; SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects psql backslash command \\connect', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: '\\connect other_db',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  // Dogfood #2 — validator showed string-concat bypass:
  // SELECT pg_catalog.set_config('default'||'_transaction_read_only', 'off', false)
  // The set_config() function family is now blocked entirely.
  it('rejects set_config(...) (the string-concat bypass vector)', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT set_config('default'||'_transaction_read_only', 'off', false)",
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(result.hint).toMatch(/set_config/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects pg_catalog.set_config(...) (the catalog-prefixed form)', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT pg_catalog.set_config('default'||'_transaction_read_only', 'off', false)",
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('allows current_setting() (read-only, legitimate)', async () => {
    execFileOk('[{"current_setting":"UTC"}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT current_setting('TimeZone')",
      read_only: true,
    });
    expect(result.ok).toBe(true);
  });

  // Round-3 #2 — the over-broad /default_transaction_read_only/i regex used
  // to reject ANY mention of the GUC name (including legitimate reads via
  // current_setting). Narrowed to /\bset\s+(local\s+)?default_transaction_read_only\b/i.
  it('allows current_setting(default_transaction_read_only) — narrowed regex (round-3 #2)', async () => {
    execFileOk('[{"current_setting":"on"}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT current_setting('default_transaction_read_only')",
      read_only: true,
    });
    expect(result.ok).toBe(true);
  });

  it('still rejects SET default_transaction_read_only (the actual GUC-flip)', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'SET default_transaction_read_only = off',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
  });

  it('rejects SET LOCAL default_transaction_read_only too', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'SET LOCAL default_transaction_read_only = off',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('blocked_keyword');
  });
});

describe('rl_db_query — dogfood #4 unknown-key rejection', () => {
  it('rejects worktree_path (silent-strip behavior would otherwise hide it)', async () => {
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worktree_path: '/Users/sdodge/foo',
    } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_param');
    expect(result.message).toContain('worktree_path');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('rl_db_query — SSH invocation shape (JSON-mode, round-3 corrected)', () => {
  it('builds the JSON-aggregation remote command (no PGOPTIONS, no CSV, no sentinel)', async () => {
    execFileOk('[{"count":42}]\n');
    await execute({
      slug: 'myslug',
      sql: 'SELECT count(*) FROM users',
      read_only: true,
    });
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe('ssh');
    const remote = String(call[1].at(-1));
    // Round-2 #1 — PGOPTIONS proven dead. SET LOCAL inside the txn is the
    // actual timeout chokepoint.
    expect(remote).not.toContain('PGOPTIONS');
    expect(remote).toMatch(/SET LOCAL statement_timeout\s*=\s*'\\''5s'\\''/);
    // Round-3 #3 — CSV mode dropped; switched to JSON-aggregation. No
    // --csv, no -P null=..., no --set=FETCH_COUNT.
    expect(remote).not.toContain('--csv');
    expect(remote).not.toContain('--set=FETCH_COUNT');
    expect(remote).not.toContain('null=');
    // psql flags — -A -t for raw-cell output, -q for quiet, ON_ERROR_STOP.
    expect(remote).toContain('-A -t -q -v ON_ERROR_STOP=1');
    // env-psql orchestrator binary path.
    expect(remote).toContain('/srv/rl-infra/orchestrator/bin/env-psql');
    // Slug shellQuoted.
    expect(remote).toContain("'myslug'");
    // BEGIN/SET TRANSACTION READ ONLY/ROLLBACK wrapper.
    expect(remote).toContain('BEGIN;');
    expect(remote).toContain('SET TRANSACTION READ ONLY;');
    expect(remote).toContain('ROLLBACK;');
    // JSON-aggregation wrap with COALESCE for the empty-result case.
    // Round-4 #1 — outer alias renamed from `t` to `__rl_q_row__` to avoid
    // collision with user columns aliased as `t`.
    expect(remote).toContain('json_agg(row_to_json(__rl_q_row__))');
    expect(remote).not.toContain('json_agg(row_to_json(t))');
    expect(remote).toContain("COALESCE");
    expect(remote).toContain("'[]'");
    // Inner subquery wrap with LIMIT 1001 (1000 + 1 truncation sentinel).
    expect(remote).toContain('SELECT * FROM (SELECT count(*) FROM users) AS rl_inner LIMIT 1001');
    expect(remote).toContain('AS __rl_q_row__;');
  });

  it('strips a trailing semicolon from user SQL before wrapping', async () => {
    execFileOk('[{"id":1}]\n');
    await execute({
      slug: 'myslug',
      sql: 'SELECT id FROM users;',
      read_only: true,
    });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    // Should wrap `SELECT id FROM users` (no trailing semicolon) so the
    // subquery is syntactically valid.
    expect(remote).toContain('(SELECT id FROM users) AS rl_inner');
  });

  it('shellQuotes the wrapped SQL — single quotes in user data round-trip (architect case 4)', async () => {
    // SQL with a doubled-up single quote (legitimate Postgres string literal
    // for "O'Brien"). The shellQuote at the SSH boundary wraps the whole
    // psql -c argument in single quotes and escapes embedded ones via
    // `'\''`. Postgres sees the original `'O''Brien'` byte-for-byte.
    execFileOk('[{"id":7,"name":"O\'Brien"}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT id, name FROM users WHERE name = 'O''Brien'",
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: 7, name: "O'Brien" }]);
    // Inspect the shell-quoted argv: every literal single quote in the
    // user SQL becomes '\'' inside the outer single-quoted argument.
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain("'\\''O'\\''");
  });
});

describe('rl_db_query — happy path JSON parsing', () => {
  it('parses a basic 2-row JSON result with columns + rows', async () => {
    // psql -At returns just the cell text — the JSON array verbatim.
    const json = JSON.stringify([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    execFileOk(json + '\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT id, name FROM users LIMIT 2',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    expect(result.row_count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(typeof result.elapsed_ms).toBe('number');
  });

  it('preserves SQL types (number, string, boolean, null) via JSON encoding (round-3 #3 fix)', async () => {
    // Round-3 dogfood proved string-based sentinels ALWAYS collide because
    // psql --csv only quotes values with delimiter/quote/newline chars. JSON
    // sidesteps the entire class — null is `null` (no quotes), string is
    // `"..."` (always quoted), number is bare. A user value of the literal
    // string `"null"` round-trips as the string, not as null.
    const json = JSON.stringify([
      { s: 'null', real_null: null, n: 42, b: true, opaque_lookalike: '__RL_NULL_e8f3a4__' },
      { s: '', real_null: null, n: 0, b: false, opaque_lookalike: '\\N' },
    ]);
    execFileOk(json + '\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      { s: 'null', real_null: null, n: 42, b: true, opaque_lookalike: '__RL_NULL_e8f3a4__' },
      { s: '', real_null: null, n: 0, b: false, opaque_lookalike: '\\N' },
    ]);
  });

  it('returns empty rows + columns for a zero-row result (json_agg → COALESCE [])', async () => {
    // COALESCE(json_agg(...), '[]'::json) — when no rows match, json_agg
    // returns NULL and COALESCE substitutes the empty array.
    execFileOk('[]\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT id FROM users WHERE id = -1',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.row_count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('truncates at 1000 rows when the JSON array has the 1001 sentinel (architect case 5)', async () => {
    // generate_series(1, 100000) → subquery LIMIT 1001 caps at 1001 rows in
    // the json_agg input. Build a fake 1001-element JSON array.
    const arr: Array<Record<string, number>> = [];
    for (let i = 1; i <= 1001; i++) arr.push({ n: i });
    execFileOk(JSON.stringify(arr) + '\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT generate_series(1, 100000) AS n',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.row_count).toBe(1000);
    expect(result.rows?.length).toBe(1000);
    expect(result.truncated).toBe(true);
    // Last kept row is the 1000th, NOT the 1001st sentinel.
    expect(result.rows?.[999]).toEqual({ n: 1000 });
  });

  it('surfaces parse errors when psql output is not valid JSON', async () => {
    execFileOk('not json at all\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db_query_failed');
    expect(result.message).toMatch(/failed to parse json/i);
  });
});

describe('rl_db_query — error classification (architect §D layers + spec §6)', () => {
  it('returns env_not_found when env-psql exits 3 (architect-locked exit code)', async () => {
    execFileFail(3, "env-psql: pg container 'rl-env-missing-pg' not found");
    const result = await execute({
      slug: 'missing',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('env_not_found');
    expect(result.slug).toBe('missing');
  });

  it('returns read_only_violation when psql says INSERT in read-only txn (architect case 1)', async () => {
    // Architect's case 1 — the layered PGOPTIONS GUC catches the smuggled INSERT.
    // Postgres surfaces: "ERROR: cannot execute INSERT in a read-only transaction".
    execFileFail(
      3,
      'ERROR:  cannot execute INSERT in a read-only transaction\n',
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'ROLLBACK; INSERT INTO users(id) VALUES (999); BEGIN',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('read_only_violation');
    expect(result.message).toMatch(/read-only transaction/i);
  });

  it('classifies CREATE-in-read-only as read_only_violation', async () => {
    execFileFail(
      3,
      'ERROR:  cannot execute CREATE TABLE in a read-only transaction\n',
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('read_only_violation');
  });

  it('returns syntax_error when subquery wrap rejects multi-statement (architect case 2)', async () => {
    // `SELECT 1; CREATE TABLE pwn(y int)` becomes
    //   SELECT * FROM (SELECT 1; CREATE TABLE pwn(y int)) AS rl_user_query LIMIT 1001
    // Postgres parses the inner subquery and chokes on the semicolon —
    // surfaces "ERROR: syntax error at or near ';'".
    execFileFail(3, "ERROR:  syntax error at or near \";\"\n");
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1; CREATE TABLE pwn(y int)',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('syntax_error');
    expect(result.hint).toMatch(/single SELECT/i);
  });

  it('returns statement_timeout when psql says canceling statement', async () => {
    execFileFail(
      3,
      'ERROR:  canceling statement due to statement timeout\n',
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT pg_sleep(10)',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('statement_timeout');
  });

  it('returns db_unreachable on ssh connection refused', async () => {
    execFileFail(
      255,
      'ssh: connect to host rl-infra port 22: Connection refused',
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db_unreachable');
  });

  it('returns db_query_failed for unknown errors with stderr verbatim', async () => {
    execFileFail(3, 'ERROR:  some novel postgres error we have not classified\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db_query_failed');
    expect(result.message).toContain('novel postgres error');
  });

  // Reviewer feedback: pin the classification order. If a future hop adds
  // `2>&1` to the db-query remote command (mirroring task-logs/infra-logs),
  // a stderr blob containing both `ssh: connect` AND a postgres "cannot
  // execute INSERT" line should still classify as `read_only_violation`
  // (the more specific match wins).
  it('classifies as read_only_violation when stderr contains BOTH ssh:connect AND a write rejection', async () => {
    execFileFail(
      1,
      'ssh: connect to host 192.168.0.132 port 22: Connection refused\n' +
        'ERROR:  cannot execute INSERT in a read-only transaction',
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('read_only_violation');
  });

  // Reviewer feedback: SSH-exit-255 with EMPTY stderr falls back to the
  // synthesized diagnostic, which doesn't match the `ssh:.*connect` regex
  // and therefore lands in `db_query_failed` rather than `db_unreachable`.
  // Pin the behavior so a future regex change doesn't surprise consumers.
  it('classifies exit-255 with empty stderr as db_unreachable via the exit-code branch', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
        // Empty stderr + exit 255 — the classic ssh-host-unreachable shape.
        const err = Object.assign(new Error(''), { code: 255 });
        callback(err, '', '');
      },
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    // exitCode === 255 triggers the db_unreachable branch even though stderr
    // was synthesized (the synth diagnostic doesn't contain `ssh:` literally).
    expect(result.error).toBe('db_unreachable');
  });
});

describe('rl_db_query — round-4 fixes', () => {
  // Round-4 #2 — bigint precision. json-bigint (storeAsString:true) keeps
  // numbers > 2^53 as JS strings so consumers can BigInt() them or
  // string-compare; safe integers stay as JS Number.
  it('preserves bigint precision for values > 2^53 (returns as string)', async () => {
    // 2^53 + 1 = 9007199254740993 (would clip to ...992 under bare JSON.parse)
    execFileOk('[{"big": 9007199254740993, "safe": 42}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows?.[0]).toEqual({ big: '9007199254740993', safe: 42 });
  });

  it('preserves numeric precision for 16-digit values', async () => {
    execFileOk('[{"n": 9999999999999999}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT 1',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    // String form preserves the original 9999999999999999 (would clip to
    // 10000000000000000 under bare JSON.parse).
    expect(result.rows?.[0]).toEqual({ n: '9999999999999999' });
  });

  // Round-4 #3 — maxBuffer overflow used to fall through to the generic
  // "ssh returned exit unknown" diagnostic. Now produces response_too_large.
  it('returns response_too_large on ERR_CHILD_PROCESS_STDIO_MAXBUFFER', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
        const err = Object.assign(new Error('stdout maxBuffer length exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        });
        callback(err, '', '');
      },
    );
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT repeat(\'x\', 20000000) AS huge',
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('response_too_large');
    expect(result.hint).toMatch(/16MB/);
  });

  // Round-4 #4 — read_only_violation regex used to require a hard-coded
  // verb (INSERT|UPDATE|...). Function-form writes (nextval, setval,
  // pg_advisory_lock) fell through to db_query_failed. Now broadened to
  // any token + optional parens.
  it('classifies function-form writes (nextval) as read_only_violation', async () => {
    execFileFail(
      1,
      'ERROR:  cannot execute nextval() in a read-only transaction',
    );
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT nextval('public.users_id_seq')",
      read_only: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('read_only_violation');
    expect(result.hint).toContain('BEGIN/SET TRANSACTION READ ONLY');
  });

  // Round-4 #1 — alias `t` collided with user columns aliased as `t`.
  // The SSH-shape test (above) asserts the new alias `__rl_q_row__` is
  // used. This test confirms a user column named `t` doesn't break the
  // happy-path flow now.
  it('handles user query with column aliased `t` (round-4 #1 regression test)', async () => {
    // psql executes `row_to_json(__rl_q_row__)` which no longer collides
    // with the user's `t` column inside the inner SELECT.
    execFileOk('[{"t": "hello"}]\n');
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT 'hello' AS t",
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows?.[0]).toEqual({ t: 'hello' });
  });
});
