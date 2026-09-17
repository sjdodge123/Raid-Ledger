/**
 * ROK-1602 — the web search's DB reads must ORDER BY relevance BEFORE the
 * 20-row LIMIT, and must admit acronym hits, or "World of Warcraft" never
 * reaches the in-memory re-sort when "wow" matches 20+ other titles.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import {
  buildSearchFilters,
  checkLocalDb,
  searchLocalGames,
} from './igdb-search.helpers';

function chainDb(): {
  db: PostgresJsDatabase<typeof schema>;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
} {
  const limit = jest.fn().mockResolvedValue([]);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const where = jest.fn().mockReturnValue({ orderBy });
  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({ where }),
    }),
  };
  return { db: db as never, where, orderBy, limit };
}

const render = (f: SQL): string => new PgDialect().sqlToQuery(f).sql;

describe('web game search DB ordering (ROK-1602)', () => {
  it('searchLocalGames orders by the relevance CASE before limiting', async () => {
    const { db, orderBy, limit } = chainDb();
    await searchLocalGames(db, 'wow', false);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(render(orderBy.mock.calls[0][0] as SQL)).toContain('CASE');
    expect(limit).toHaveBeenCalledWith(20);
  });

  it('checkLocalDb orders by the relevance CASE before limiting', async () => {
    const { db, orderBy } = chainDb();
    await checkLocalDb(db, buildSearchFilters('wow', false), 'wow');
    expect(render(orderBy.mock.calls[0][0] as SQL)).toContain('CASE');
  });

  it('buildSearchFilters admits acronym matches for "wow"', () => {
    const [nameFilter] = buildSearchFilters('wow', false);
    expect(render(nameFilter)).toContain('\\1');
  });
});
