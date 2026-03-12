/**
 * Unit tests for igdb-interest.helpers — getSteamOwners (ROK-745),
 * getSteamWishlistCount / isWishlistedByUser (ROK-418),
 * and getInterestCount / getInterestedPlayers dedup (ROK-804).
 */
import {
  getSteamOwners,
  getSteamOwnerCount,
  getSteamWishlistCount,
  isWishlistedByUser,
} from './igdb-steam-interest.helpers';
import {
  getInterestCount,
  getInterestedPlayers,
} from './igdb-interest.helpers';

// ─── Shared mock builder ────────────────────────────────────────────────────

function buildOwnerDb(
  rows: {
    id: number;
    username: string;
    avatar: string | null;
    customAvatarUrl: string | null;
    discordId: string | null;
  }[],
  count: number,
): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  const chainMethods = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
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
      {
        id: 1,
        username: 'Player1',
        avatar: null,
        customAvatarUrl: null,
        discordId: '111',
      },
      {
        id: 2,
        username: 'Player2',
        avatar: 'hash',
        customAvatarUrl: null,
        discordId: '222',
      },
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

// ─── getSteamWishlistCount (ROK-418) ───────────────────────────────────────

describe('getSteamWishlistCount', () => {
  function buildCountDb(count: number): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([{ count }]);
    return db;
  }

  it('returns wishlist count for a game', async () => {
    const db = buildCountDb(7);
    const result = await getSteamWishlistCount(db as never, 42);
    expect(result).toBe(7);
  });

  it('returns 0 when no users wishlisted the game', async () => {
    const db = buildCountDb(0);
    const result = await getSteamWishlistCount(db as never, 99);
    expect(result).toBe(0);
  });

  it('returns 0 when query returns undefined result', async () => {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([undefined]);
    const result = await getSteamWishlistCount(db as never, 1);
    expect(result).toBe(0);
  });
});

// ─── isWishlistedByUser (ROK-418) ──────────────────────────────────────────

describe('isWishlistedByUser', () => {
  function buildWishlistCheckDb(hasRow: boolean): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from', 'orderBy']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockResolvedValue(hasRow ? [{ id: 1 }] : []);
    return db;
  }

  it('returns true when user has wishlisted the game', async () => {
    const db = buildWishlistCheckDb(true);
    const result = await isWishlistedByUser(db as never, 42, 1);
    expect(result).toBe(true);
  });

  it('returns false when user has not wishlisted the game', async () => {
    const db = buildWishlistCheckDb(false);
    const result = await isWishlistedByUser(db as never, 42, 1);
    expect(result).toBe(false);
  });

  it('returns false for empty array result', async () => {
    const db = buildWishlistCheckDb(false);
    const result = await isWishlistedByUser(db as never, 99, 99);
    expect(result).toBe(false);
  });
});

// ─── getInterestCount (ROK-804) ─────────────────────────────────────────────

describe('getInterestCount', () => {
  function buildCountDb(count: number): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([{ count }]);
    return db;
  }

  it('returns interest count for a game', async () => {
    const db = buildCountDb(3);
    const result = await getInterestCount(db as never, 42);
    expect(result).toBe(3);
  });

  it('returns 0 when no interests exist', async () => {
    const db = buildCountDb(0);
    const result = await getInterestCount(db as never, 99);
    expect(result).toBe(0);
  });
});

// ─── getInterestedPlayers (ROK-804) ─────────────────────────────────────────

describe('getInterestedPlayers', () => {
  function buildPlayersDb(
    rows: {
      id: number;
      username: string;
      avatar: string | null;
      customAvatarUrl: string | null;
      discordId: string | null;
    }[],
  ): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chain = ['from', 'innerJoin', 'orderBy'];
    for (const m of chain) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.selectDistinctOn = jest.fn().mockReturnThis();
    db.select = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockResolvedValue(rows);
    return db;
  }

  it('returns player previews', async () => {
    const players = [
      {
        id: 1,
        username: 'Alice',
        avatar: null,
        customAvatarUrl: null,
        discordId: '111',
      },
      {
        id: 2,
        username: 'Bob',
        avatar: 'hash',
        customAvatarUrl: null,
        discordId: '222',
      },
    ];
    const db = buildPlayersDb(players);
    const result = await getInterestedPlayers(db as never, 42);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: expect.any(Number),
      username: expect.any(String),
    });
  });

  it('uses selectDistinctOn to deduplicate users', async () => {
    const db = buildPlayersDb([]);
    await getInterestedPlayers(db as never, 42);

    expect(db.selectDistinctOn).toHaveBeenCalled();
  });

  it('returns empty array when no interested players exist', async () => {
    const db = buildPlayersDb([]);
    const result = await getInterestedPlayers(db as never, 99);
    expect(result).toEqual([]);
  });
});
