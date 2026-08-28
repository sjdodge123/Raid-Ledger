/**
 * Shared Drizzle ORM mock for unit tests.
 *
 * Creates a flat chain mock where every query-builder method returns `this`.
 * Control results by overriding terminal methods:
 *
 *   mockDb.limit.mockResolvedValue([row]);           // single query
 *   mockDb.limit.mockResolvedValueOnce([row1])       // sequential queries
 *                .mockResolvedValueOnce([row2]);
 *
 * Pattern lifted from users.service.spec.ts:13-34 and generalised to cover
 * all Drizzle chain methods observed across the codebase.
 */
/** All Drizzle chain methods observed across the codebase. */
const CHAIN_METHODS = [
  'select',
  'from',
  'where',
  'orderBy',
  'limit',
  'offset',
  'leftJoin',
  'innerJoin',
  'insert',
  'values',
  'returning',
  'onConflictDoNothing',
  'onConflictDoUpdate',
  'update',
  'set',
  'delete',
  'groupBy',
  'having',
  '$dynamic',
  'execute',
  'as',
];

/**
 * `query` mirrors Drizzle's relational-query namespace. Tests may overwrite
 * this object wholesale (with arbitrary subsets of relations), so we keep it
 * loose to match runtime flexibility.
 */

type DrizzleQueryNamespace = Record<string, any>;

export type MockDb = Record<string, jest.Mock> & {
  query: DrizzleQueryNamespace;
};

export function createDrizzleMock(): MockDb {
  const mock = {} as MockDb;
  for (const m of CHAIN_METHODS) {
    mock[m] = jest.fn().mockReturnThis();
  }
  mock.transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: typeof mock) => Promise<unknown>) =>
      cb(mock),
    );
  mock.query = {
    users: { findFirst: jest.fn(), findMany: jest.fn() },
    events: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  return mock;
}

/**
 * Give a hand-rolled mock db the transaction surface `withGameNameLock` needs.
 *
 * ROK-1438 wrapped every find-then-insert into `games` in a transaction that
 * first issues an advisory-lock SELECT. Specs that build their own chain mocks
 * (rather than `createDrizzleMock()`) need `transaction` to pass the same mock
 * through as the tx handle, and `execute` to swallow the lock statement.
 *
 * Mutates and returns `mock` so existing `const m = createXMockDb()` call sites
 * keep their direct references to the individual jest.fn()s.
 */
export function withMockTransaction<T extends object>(mock: T): T {
  const m = mock as T & { transaction?: jest.Mock; execute?: jest.Mock };
  m.execute ??= jest.fn().mockResolvedValue(undefined);
  m.transaction ??= jest
    .fn()
    .mockImplementation((cb: (tx: T) => Promise<unknown>) => cb(mock));
  return mock;
}
