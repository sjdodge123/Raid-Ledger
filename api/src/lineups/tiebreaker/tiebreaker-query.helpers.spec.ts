/**
 * findPendingOrActiveTiebreaker must pick a deterministic row when a lineup
 * has more than one non-dismissed tiebreaker: newest first, id as tie-break.
 */
import { desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import * as schema from '../../drizzle/schema';
import { findPendingOrActiveTiebreaker } from './tiebreaker-query.helpers';

describe('findPendingOrActiveTiebreaker', () => {
  it('orders newest first (createdAt, then id) and takes one row', async () => {
    const mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([]);
    const db = mockDb as unknown as PostgresJsDatabase<typeof schema>;

    await findPendingOrActiveTiebreaker(db, 7);

    const t = schema.communityLineupTiebreakers;
    expect(mockDb.orderBy).toHaveBeenCalledWith(desc(t.createdAt), desc(t.id));
    expect(mockDb.limit).toHaveBeenCalledWith(1);
  });
});
