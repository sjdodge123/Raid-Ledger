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
});

describe('rl_db_query — SSH invocation shape (hardened per architect)', () => {
  it('builds the architect-locked PGOPTIONS + subquery-wrap remote command', async () => {
    execFileOk('count\n42\n');
    await execute({
      slug: 'myslug',
      sql: 'SELECT count(*) FROM users',
      read_only: true,
    });
    const call = mockExecFile.mock.calls[0];
    expect(call[0]).toBe('ssh');
    const remote = String(call[1].at(-1));
    // Layer 1 — PGOPTIONS connect-time GUC (the chokepoint).
    expect(remote).toContain(
      "PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000'",
    );
    // env-psql orchestrator binary path.
    expect(remote).toContain('/srv/rl-infra/orchestrator/bin/env-psql');
    // Slug shellQuoted.
    expect(remote).toContain("'myslug'");
    // psql flags — CSV, quiet (suppress BEGIN/SET/ROLLBACK command-tag echo —
    // dogfood-surfaced; without `-q`, those echoes poison CSV parsing),
    // ON_ERROR_STOP, NULL sentinel double-escape, FETCH_COUNT.
    expect(remote).toContain('--csv');
    expect(remote).toContain('-q ');
    expect(remote).toContain('-v ON_ERROR_STOP=1');
    expect(remote).toContain('-P null=\\\\N');
    expect(remote).toContain('--set=FETCH_COUNT=1001');
    // Layer 2 — BEGIN/SET TRANSACTION READ ONLY/ROLLBACK wrapper.
    expect(remote).toContain('BEGIN;');
    expect(remote).toContain('SET TRANSACTION READ ONLY;');
    expect(remote).toContain('ROLLBACK;');
    // Layer 4 — subquery wrap with LIMIT 1001 (1000 + 1 sentinel for truncation).
    expect(remote).toContain('SELECT * FROM (SELECT count(*) FROM users) AS rl_user_query LIMIT 1001');
  });

  it('strips a trailing semicolon from user SQL before wrapping', async () => {
    execFileOk('id\n1\n');
    await execute({
      slug: 'myslug',
      sql: 'SELECT id FROM users;',
      read_only: true,
    });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    // Should wrap `SELECT id FROM users` (no trailing semicolon) so the
    // subquery is syntactically valid.
    expect(remote).toContain('(SELECT id FROM users) AS rl_user_query');
  });

  it('shellQuotes the wrapped SQL — single quotes in user data round-trip (architect case 4)', async () => {
    // SQL with a doubled-up single quote (legitimate Postgres string literal
    // for "O'Brien"). The shellQuote at the SSH boundary wraps the whole
    // psql -c argument in single quotes and escapes embedded ones via
    // `'\''`. Postgres sees the original `'O''Brien'` byte-for-byte.
    execFileOk('id,name\n7,O\'Brien\n');
    const result = await execute({
      slug: 'myslug',
      sql: "SELECT id, name FROM users WHERE name = 'O''Brien'",
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: '7', name: "O'Brien" }]);
    // Inspect the shell-quoted argv: every literal single quote in the
    // user SQL becomes '\'' inside the outer single-quoted argument.
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain("'\\''O'\\''");
  });
});

describe('rl_db_query — happy path CSV parsing', () => {
  it('parses a basic header + 2-row CSV result with columns + rows', async () => {
    const csv = 'id,name\n1,Alice\n2,Bob\n';
    execFileOk(csv);
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT id, name FROM users LIMIT 2',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    expect(result.row_count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(typeof result.elapsed_ms).toBe('number');
  });

  it('maps unquoted \\N to JS null; quoted "" stays empty string; quoted "\\N" stays literal', async () => {
    // Architect §C — NULL vs empty string vs literal `\N` distinguishable.
    const csv = 'id,name,deleted_at\n1,Alice,\\N\n2,"",2026-01-01\n3,"\\N",NULL\n';
    execFileOk(csv);
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT id, name, deleted_at FROM users',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      { id: '1', name: 'Alice', deleted_at: null },
      { id: '2', name: '', deleted_at: '2026-01-01' },
      { id: '3', name: '\\N', deleted_at: 'NULL' },
    ]);
  });

  it('returns empty rows array for a header-only CSV (zero result rows)', async () => {
    execFileOk('id,name\n');
    const result = await execute({
      slug: 'myslug',
      sql: 'SELECT id, name FROM users WHERE id = -1',
      read_only: true,
    });
    expect(result.ok).toBe(true);
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toEqual([]);
    expect(result.row_count).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('truncates at 1000 rows when psql returns the 1001 sentinel (architect case 5)', async () => {
    // generate_series(1, 100000) would normally return 100k rows; the subquery
    // LIMIT 1001 caps the response at 1001. Build a fake 1001-row CSV.
    const header = 'n';
    const dataRows: string[] = [];
    for (let i = 1; i <= 1001; i++) dataRows.push(String(i));
    const csv = [header, ...dataRows].join('\n') + '\n';
    execFileOk(csv);
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
    expect(result.rows?.[999]).toEqual({ n: '1000' });
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
});
