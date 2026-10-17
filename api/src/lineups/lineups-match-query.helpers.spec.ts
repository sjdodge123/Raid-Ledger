/**
 * Unit tests for lineups-match-query.helpers (TDB:1143).
 * findMatchesByLineup must return rows in a deterministic (id) order so
 * tier grouping is stable on ties.
 */
import { asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { findMatchesByLineup } from './lineups-match-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

describe('findMatchesByLineup', () => {
  it('orders matches by id ascending', () => {
    const mockDb = createDrizzleMock();
    findMatchesByLineup(mockDb as unknown as Db, 42);
    expect(mockDb.orderBy).toHaveBeenCalledTimes(1);
    expect(mockDb.orderBy).toHaveBeenCalledWith(
      asc(schema.communityLineupMatches.id),
    );
  });
});
