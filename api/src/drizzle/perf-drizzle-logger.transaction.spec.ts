import type { Sql } from 'postgres';
import { withQueryPerfLogging } from './perf-drizzle-logger';
import * as perfLoggerModule from '../common/perf-logger';

jest.mock('../common/perf-logger', () => ({
  isPerfEnabled: jest.fn(),
  perfLog: jest.fn(),
}));

const mockIsPerfEnabled = perfLoggerModule.isPerfEnabled as jest.Mock;
const mockPerfLog = perfLoggerModule.perfLog as jest.Mock;

type ScopeFn = (sql: FakeSql) => unknown;

interface FakeSql {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
  begin: (...args: unknown[]) => Promise<unknown>;
  savepoint: (...args: unknown[]) => Promise<unknown>;
}

/** A statement rejects when its text contains `FAIL`; otherwise resolves. */
function fakeUnsafe(query: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (query.includes('FAIL')) reject(new Error(`boom: ${query}`));
      else resolve([{ id: 1 }]);
    }, 1);
  });
}

function lastFn(args: unknown[]): ScopeFn {
  const fn = args[args.length - 1];
  if (typeof fn !== 'function') throw new Error('no scope callback');
  return (sql) => Reflect.apply(fn, undefined, [sql]) as unknown;
}

/**
 * Mirrors postgres-js: `begin(fn)` / `begin(opts, fn)` and `savepoint(fn)` /
 * `savepoint(name, fn)` each hand the callback a FRESH scoped `sql` object
 * (not the pool client), and rethrow the callback's error after "rollback".
 */
function makeSql(): FakeSql {
  const sql: FakeSql = {
    unsafe: jest.fn(fakeUnsafe),
    begin: (...args) => runScope(args),
    savepoint: (...args) => runScope(args),
  };
  return sql;
}

async function runScope(args: unknown[]): Promise<unknown> {
  const fn = lastFn(args);
  return await fn(makeSql());
}

function loggedTables(): unknown[] {
  return mockPerfLog.mock.calls.map(
    (call: unknown[]) => (call[3] as { table?: unknown } | undefined)?.table,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withQueryPerfLogging — statements inside a transaction', () => {
  it('logs one [PERF] DB line per statement run on the begin() sql', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = makeSql();
    withQueryPerfLogging(client as unknown as Sql);

    await client.begin(async (tx: FakeSql) => {
      await tx.unsafe('SELECT * FROM users WHERE id = $1', [1]);
      await tx.unsafe('UPDATE events SET title = $1', ['x']);
    });

    expect(loggedTables()).toEqual(['users', 'events']);
    expect(mockPerfLog.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'DB',
      'DB',
    ]);
  });

  it('logs statements in begin(options, fn) and nested savepoints', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = makeSql();
    withQueryPerfLogging(client as unknown as Sql);

    await client.begin('isolation level serializable', async (tx: FakeSql) => {
      await tx.unsafe('INSERT INTO signups (id) VALUES ($1)', [1]);
      await tx.savepoint('inner', async (sp: FakeSql) => {
        await sp.unsafe('DELETE FROM characters WHERE id = $1', [2]);
      });
    });

    expect(loggedTables()).toEqual(['signups', 'characters']);
  });

  it('passes the callback result through and rethrows a failing statement', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = makeSql();
    withQueryPerfLogging(client as unknown as Sql);

    const ok = await client.begin(async (tx: FakeSql) => {
      await tx.unsafe('SELECT 1 FROM users', []);
      return 'committed';
    });
    expect(ok).toBe('committed');

    await expect(
      client.begin(async (tx: FakeSql) => {
        await tx.unsafe('UPDATE FAIL_events SET x = 1', []);
      }),
    ).rejects.toThrow('boom: UPDATE FAIL_events SET x = 1');
    const statuses = mockPerfLog.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as { status?: unknown } | undefined)?.status,
    );
    expect(statuses).toEqual(['ok', 'err']);
  });
});

describe('withQueryPerfLogging — transaction, perf logging off', () => {
  it('emits nothing and leaves begin() untouched', async () => {
    mockIsPerfEnabled.mockReturnValue(false);
    const client = makeSql();
    const originalBegin = client.begin;
    withQueryPerfLogging(client as unknown as Sql);

    await client.begin(async (tx: FakeSql) => {
      await tx.unsafe('SELECT * FROM users', []);
    });

    expect(client.begin).toBe(originalBegin);
    expect(mockPerfLog).not.toHaveBeenCalled();
  });
});
