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
export function createDrizzleMock() {
  const mock: Record<string, jest.Mock> = {};

  const chainMethods = [
    // Core query builder
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    // Joins
    'leftJoin',
    'innerJoin',
    // Insert chain
    'insert',
    'values',
    'returning',
    'onConflictDoNothing',
    'onConflictDoUpdate',
    // Update chain
    'update',
    'set',
    // Delete
    'delete',
    // Advanced
    'groupBy',
    '$dynamic',
    'execute',
    'as',
  ];

  for (const m of chainMethods) {
    mock[m] = jest.fn().mockReturnThis();
  }

  // Transaction support — executes the callback with the mock as the tx arg
  mock.transaction = jest.fn().mockImplementation(
    async (cb: (tx: typeof mock) => Promise<unknown>) => cb(mock),
  );

  // Relational query API (used by some services)
  mock.query = {
    users: { findFirst: jest.fn(), findMany: jest.fn() },
    events: { findFirst: jest.fn(), findMany: jest.fn() },
  } as unknown as jest.Mock;

  return mock;
}

export type MockDb = ReturnType<typeof createDrizzleMock>;
