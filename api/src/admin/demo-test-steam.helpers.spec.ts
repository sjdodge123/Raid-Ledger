import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  addGameInterestForTest,
  clearGameInterestForTest,
  setSteamAppIdForTest,
  getGameForTest,
} from './demo-test-steam.helpers';

type Db = PostgresJsDatabase<typeof schema>;

describe('demo-test-steam.helpers', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('addGameInterestForTest inserts idempotently', async () => {
    await addGameInterestForTest(db as unknown as Db, 1, 2);
    expect(db.insert).toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith({
      userId: 1,
      gameId: 2,
      source: 'manual',
    });
    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });

  it('clearGameInterestForTest deletes the interest row', async () => {
    await clearGameInterestForTest(db as unknown as Db, 1, 2);
    expect(db.delete).toHaveBeenCalled();
    expect(db.where).toHaveBeenCalled();
  });

  it('setSteamAppIdForTest updates the game row', async () => {
    await setSteamAppIdForTest(db as unknown as Db, 5, 12345);
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({ steamAppId: 12345 });
  });

  it('getGameForTest returns the row when found', async () => {
    db.limit.mockResolvedValue([{ id: 5, name: 'Deep Rock' }]);
    const game = await getGameForTest(db as unknown as Db, 5);
    expect(game).toEqual({ id: 5, name: 'Deep Rock' });
  });

  it('getGameForTest returns null when missing', async () => {
    db.limit.mockResolvedValue([]);
    const game = await getGameForTest(db as unknown as Db, 999);
    expect(game).toBeNull();
  });
});
