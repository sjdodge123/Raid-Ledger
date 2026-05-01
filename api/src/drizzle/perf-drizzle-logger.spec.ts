import type { Sql } from 'postgres';
import { withQueryPerfLogging } from './perf-drizzle-logger';
import * as perfLoggerModule from '../common/perf-logger';

jest.mock('../common/perf-logger', () => ({
  isPerfEnabled: jest.fn(),
  perfLog: jest.fn(),
}));

const mockIsPerfEnabled = perfLoggerModule.isPerfEnabled as jest.Mock;
const mockPerfLog = perfLoggerModule.perfLog as jest.Mock;

interface FakePending {
  then: (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise<unknown>;
  values: () => FakePending;
}

/**
 * Build a fake postgres-js client whose `unsafe` returns a thenable that
 * resolves after `delayMs` (uses real time so duration is non-zero in tests).
 */
function buildFakeClient(delayMs: number, fail = false): Sql {
  const unsafe = jest.fn(() => {
    let resolve: (v: unknown) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    setTimeout(() => {
      if (fail) reject(new Error('boom'));
      else resolve([{ id: 1 }]);
    }, delayMs);

    const pending: FakePending = {
      then: (onFulfilled, onRejected) => promise.then(onFulfilled, onRejected),
      values: () => pending,
    };
    return pending;
  });

  return { unsafe } as unknown as Sql;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withQueryPerfLogging — disabled', () => {
  it('returns the client unchanged when perf logging is disabled', () => {
    mockIsPerfEnabled.mockReturnValue(false);
    const client = buildFakeClient(1);
    const wrapped = withQueryPerfLogging(client);
    expect(wrapped).toBe(client);
  });
});

describe('withQueryPerfLogging — duration & meta', () => {
  it('emits a [PERF] DB log with non-zero duration when the query resolves', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = buildFakeClient(20);
    withQueryPerfLogging(client);

    await client.unsafe('SELECT * FROM users WHERE id = $1', [1]);

    expect(mockPerfLog).toHaveBeenCalledTimes(1);
    const [category, operation, durationMs, meta] = mockPerfLog.mock
      .calls[0] as [string, string, number, Record<string, unknown>];
    expect(category).toBe('DB');
    expect(operation).toBe('query');
    expect(durationMs).toBeGreaterThan(0);
    expect(meta).toMatchObject({ status: 'ok', table: 'users' });
  });

  it('extracts the table name for INSERT, UPDATE, JOIN', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const tables: string[] = [];
    const cases = [
      'INSERT INTO events (id) VALUES ($1)',
      'UPDATE characters SET name = $1',
      'SELECT * FROM events JOIN signups ON ...',
    ];
    for (const sql of cases) {
      jest.clearAllMocks();
      const client = buildFakeClient(1);
      withQueryPerfLogging(client);
      await client.unsafe(sql, []);
      const meta = mockPerfLog.mock.calls[0][3] as { table: string };
      tables.push(meta.table);
    }
    expect(tables).toEqual(['events', 'characters', 'events']);
  });

  it('truncates long query text in the log meta', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const longQuery = 'SELECT ' + 'x,'.repeat(200) + ' FROM users';
    const client = buildFakeClient(1);
    withQueryPerfLogging(client);
    await client.unsafe(longQuery, []);

    const meta = mockPerfLog.mock.calls[0][3] as { query: string };
    expect(meta.query.length).toBeLessThanOrEqual(203);
    expect(meta.query.endsWith('...')).toBe(true);
  });
});

describe('withQueryPerfLogging — failure & chained paths', () => {
  it('logs status=err and rethrows when the query rejects', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = buildFakeClient(5, true);
    withQueryPerfLogging(client);

    await expect(client.unsafe('SELECT 1', [])).rejects.toThrow('boom');
    expect(mockPerfLog).toHaveBeenCalledTimes(1);
    expect(mockPerfLog.mock.calls[0][3]).toMatchObject({ status: 'err' });
  });

  it('times the chained .values() form (drizzle path B)', async () => {
    mockIsPerfEnabled.mockReturnValue(true);
    const client = buildFakeClient(15);
    withQueryPerfLogging(client);

    const pending = client.unsafe('SELECT id FROM users', []) as unknown as {
      values: () => Promise<unknown>;
    };
    await pending.values();

    expect(mockPerfLog).toHaveBeenCalledTimes(1);
    const durationMs = mockPerfLog.mock.calls[0][2] as number;
    expect(durationMs).toBeGreaterThan(0);
  });
});
