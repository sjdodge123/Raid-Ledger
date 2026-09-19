/**
 * Unit coverage for the `GET /games/configured` projection (ROK-1407).
 *
 * The endpoint's body must be byte-stable between real config changes so the
 * weak ETag Express already emits can revalidate to 304. Two sources of churn
 * are asserted here: the row order (name alone is not a deterministic sort
 * under duplicate names) and the `genres` array order (written verbatim in
 * IGDB's response order, so a reorder rewrites the same set).
 */
import { and, eq } from 'drizzle-orm';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import { listConfiguredGames } from './igdb-registry.helpers';

type Db = Parameters<typeof listConfiguredGames>[0];

/** Minimal registry row — only the fields the assertions care about. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'game',
    name: 'Game',
    shortName: null,
    coverUrl: null,
    colorHex: null,
    hasRoles: false,
    hasSpecs: false,
    enabled: true,
    maxCharactersPerUser: 1,
    genres: [],
    playerCount: null,
    ...overrides,
  };
}

describe('listConfiguredGames (ROK-1407 byte stability)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  /** Resolve the awaited chain at `.orderBy()` — the query's terminal call. */
  function resolveWith(rows: Record<string, unknown>[]): void {
    mockDb.orderBy.mockResolvedValue(rows);
  }

  it('orders by name AND id so duplicate names cannot swap between runs', async () => {
    resolveWith([]);

    await listConfiguredGames(mockDb as unknown as Db);

    expect(mockDb.orderBy).toHaveBeenCalledWith(
      schema.games.name,
      schema.games.id,
    );
  });

  it('excludes banned rows as well as disabled ones', async () => {
    resolveWith([]);

    await listConfiguredGames(mockDb as unknown as Db);

    expect(mockDb.where).toHaveBeenCalledWith(
      and(eq(schema.games.enabled, true), eq(schema.games.banned, false)),
    );
  });

  it('projects genres in ascending order regardless of the stored order', async () => {
    resolveWith([row({ genres: [31, 12, 5] })]);

    const result = await listConfiguredGames(mockDb as unknown as Db);

    expect(result.data[0].genres).toEqual([5, 12, 31]);
  });

  it('never mutates the source row while sorting genres', async () => {
    const stored = [31, 12, 5];
    resolveWith([row({ genres: stored })]);

    await listConfiguredGames(mockDb as unknown as Db);

    expect(stored).toEqual([31, 12, 5]);
  });

  it('coerces a null genres column to an empty array', async () => {
    resolveWith([row({ genres: null })]);

    const result = await listConfiguredGames(mockDb as unknown as Db);

    expect(result.data[0].genres).toEqual([]);
  });

  it('reports the row count in meta.total', async () => {
    resolveWith([row({ id: 1 }), row({ id: 2 })]);

    const result = await listConfiguredGames(mockDb as unknown as Db);

    expect(result.meta.total).toBe(2);
  });
});
