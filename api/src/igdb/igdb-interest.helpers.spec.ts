/**
 * Unit tests for igdb-interest.helpers — getSteamOwners (ROK-745).
 *
 * Tests the getSteamOwners helper that queries game_interests
 * WHERE source = 'steam_library' to find users who own a game on Steam.
 */
import { getSteamOwners, getSteamOwnerCount } from './igdb-interest.helpers';

// ─── Shared mock builder ────────────────────────────────────────────────────

function buildOwnerDb(
  rows: { id: number; username: string; avatar: string | null; customAvatarUrl: string | null; discordId: string | null }[],
  count: number,
): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  const chainMethods = [
    'select', 'from', 'innerJoin', 'orderBy', 'groupBy',
  ];
  for (const m of chainMethods) {
    db[m] = jest.fn().mockReturnThis();
  }

  // getSteamOwners: .where(and(...)).limit(8)
  // getSteamOwnerCount: .where(eq(...)) terminal
  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) {
      // getSteamOwners — chain continues to .orderBy.limit
      return db;
    }
    // getSteamOwnerCount — terminal
    return Promise.resolve([{ count }]);
  });

  db.limit = jest.fn().mockResolvedValue(rows);

  return db;
}

// ─── getSteamOwners ─────────────────────────────────────────────────────────

describe('getSteamOwners', () => {
  it('returns player previews for Steam owners', async () => {
    const mockPlayers = [
      { id: 1, username: 'Player1', avatar: null, customAvatarUrl: null, discordId: '111' },
      { id: 2, username: 'Player2', avatar: 'hash', customAvatarUrl: null, discordId: '222' },
    ];
    const db = buildOwnerDb(mockPlayers, 2);

    const result = await getSteamOwners(db as never, 42);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: expect.any(Number),
      username: expect.any(String),
    });
  });

  it('returns empty array when no Steam owners exist', async () => {
    const db = buildOwnerDb([], 0);
    const result = await getSteamOwners(db as never, 99);
    expect(result).toEqual([]);
  });

  it('filters by steam_library source via where clause', async () => {
    const db = buildOwnerDb([], 0);
    await getSteamOwners(db as never, 42);
    expect(db.where).toHaveBeenCalled();
  });
});

// ─── getSteamOwnerCount ─────────────────────────────────────────────────────

describe('getSteamOwnerCount', () => {
  it('returns count of Steam owners for a game', async () => {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = ['select', 'from'];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([{ count: 5 }]);

    const result = await getSteamOwnerCount(db as never, 42);
    expect(result).toBe(5);
  });

  it('returns 0 when no owners exist', async () => {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = ['select', 'from'];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([{ count: 0 }]);

    const result = await getSteamOwnerCount(db as never, 42);
    expect(result).toBe(0);
  });
});
