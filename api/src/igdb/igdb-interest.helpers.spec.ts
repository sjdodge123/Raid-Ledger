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
  batchCheckInterests,
  removeInterest,
  HEART_SOURCES,
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

  it('caps results at 8 players (preview limit)', async () => {
    const eightPlayers = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      username: `Player${i + 1}`,
      avatar: null,
      customAvatarUrl: null,
      discordId: String(i + 100),
    }));
    const db = buildPlayersDb(eightPlayers);
    const result = await getInterestedPlayers(db as never, 42);
    expect(result).toHaveLength(8);
    expect(db.limit).toHaveBeenCalledWith(8);
  });

  it('maps all expected player fields to the response', async () => {
    const player = {
      id: 5,
      username: 'Zara',
      avatar: 'avatarHash',
      customAvatarUrl: 'https://example.com/avatar.png',
      discordId: '777888999',
    };
    const db = buildPlayersDb([player]);
    const result = await getInterestedPlayers(db as never, 42);
    expect(result[0]).toEqual({
      id: 5,
      username: 'Zara',
      avatar: 'avatarHash',
      customAvatarUrl: 'https://example.com/avatar.png',
      discordId: '777888999',
    });
  });

  it('does not include extra fields beyond the player preview shape', async () => {
    const player = {
      id: 1,
      username: 'Alice',
      avatar: null,
      customAvatarUrl: null,
      discordId: '111',
    };
    const db = buildPlayersDb([player]);
    const result = await getInterestedPlayers(db as never, 42);
    const keys = Object.keys(result[0]);
    expect(keys.sort()).toEqual(
      ['id', 'username', 'avatar', 'customAvatarUrl', 'discordId'].sort(),
    );
  });
});

// ─── getInterestCount — adversarial edge cases (ROK-804) ────────────────────

describe('getInterestCount — adversarial edge cases', () => {
  function buildCountDb(count: number): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([{ count }]);
    return db;
  }

  it('returns 0 when DB returns an empty array (no rows at all)', async () => {
    const db: Record<string, jest.Mock> = {};
    for (const m of ['select', 'from']) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.where = jest.fn().mockResolvedValue([]);
    const result = await getInterestCount(db as never, 42);
    expect(result).toBe(0);
  });

  it('returns correct count when a user has 3 source entries (distinct collapses to 1)', async () => {
    // The DISTINCT_USER_COUNT SQL already deduplicates at DB level.
    // We verify that getInterestCount correctly passes through the DB result.
    const db = buildCountDb(1);
    const result = await getInterestCount(db as never, 42);
    expect(result).toBe(1);
  });

  it('returns the numeric count, not a string or object', async () => {
    const db = buildCountDb(7);
    const result = await getInterestCount(db as never, 42);
    expect(typeof result).toBe('number');
    expect(result).toBe(7);
  });

  it('handles large counts without type coercion issues', async () => {
    const db = buildCountDb(9999);
    const result = await getInterestCount(db as never, 1);
    expect(result).toBe(9999);
  });
});

// ─── removeInterest — poll-source suppression (ROK-1031 Gap 2) ────────────────

describe('removeInterest — poll-source suppression', () => {
  function buildRemoveInterestDb(
    source: string | null,
  ): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = ['from', 'innerJoin', 'orderBy', 'groupBy'];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }
    db.select = jest.fn().mockReturnThis();
    db.selectDistinctOn = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    db.delete = jest.fn().mockReturnThis();

    // getUserInterestSource: select().from().where().limit() → source
    // removeInterest delete: delete().where() → void
    // getInterestCount: select().from().where() → [{ count }]
    // getInterestedPlayers: selectDistinctOn().from().innerJoin().where().orderBy().limit() → []
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) return db; // getUserInterestSource chain → .limit()
      if (whereCallCount === 2) return Promise.resolve(undefined); // delete
      if (whereCallCount === 3) return Promise.resolve([{ count: 0 }]); // getInterestCount
      return db; // getInterestedPlayers chain
    });
    db.limit = jest.fn().mockImplementation(() => {
      // First limit: getUserInterestSource → returns source row
      // Subsequent limits: getInterestedPlayers → returns []
      return Promise.resolve(source ? [{ source }] : []);
    });

    return db;
  }

  it('creates suppression row when source is "poll"', async () => {
    const db = buildRemoveInterestDb('poll');

    await removeInterest(db as never, 42, 7);

    expect(db.insert).toHaveBeenCalled();
  });

  it('creates suppression row when source is "discord"', async () => {
    const db = buildRemoveInterestDb('discord');

    await removeInterest(db as never, 42, 7);

    expect(db.insert).toHaveBeenCalled();
  });

  it('does not create suppression row when source is "manual"', async () => {
    const db = buildRemoveInterestDb('manual');

    await removeInterest(db as never, 42, 7);

    // insert should be called only for delete, not for suppression
    // We check insert was NOT called (the delete uses db.delete, not db.insert)
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ─── HEART_SOURCES constant — adversarial (ROK-804) ─────────────────────────

describe('HEART_SOURCES constant', () => {
  it('contains exactly manual, discord, steam, poll — no other values', () => {
    expect(HEART_SOURCES).toHaveLength(4);
    expect(HEART_SOURCES).toContain('manual');
    expect(HEART_SOURCES).toContain('discord');
    expect(HEART_SOURCES).toContain('steam');
    expect(HEART_SOURCES).toContain('poll');
  });

  it('does not include steam_library (ownership, not interest)', () => {
    expect(HEART_SOURCES).not.toContain('steam_library');
  });

  it('does not include steam_wishlist (wishlist, not heart)', () => {
    expect(HEART_SOURCES).not.toContain('steam_wishlist');
  });
});

// ─── batchCheckInterests — adversarial edge cases (ROK-804) ─────────────────

describe('batchCheckInterests — deduplication and HEART_SOURCES filter', () => {
  function buildBatchDb(
    countRows: { gameId: number; count: number }[],
    userInterestRows: { gameId: number }[],
  ): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = ['from', 'where', 'innerJoin', 'orderBy'];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }

    // batchCheckInterests calls fetchBatchData which runs Promise.all on two queries:
    //   1. count query: select({gameId, count}).from().where().groupBy() → terminal at groupBy
    //   2. user interest query: select({gameId}).from().where() → terminal at where
    // We track select calls to distinguish them.
    db.select = jest.fn().mockReturnThis();

    db.groupBy = jest.fn().mockImplementation(() => {
      // count query terminates here
      return Promise.resolve(countRows);
    });

    // The second select().from().where() resolves directly at where()
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      // first where is from the count query's chain (before groupBy)
      // second where resolves the user-interest query
      if (whereCallCount === 1) {
        return db; // count query chains to groupBy
      }
      return Promise.resolve(userInterestRows);
    });

    return db;
  }

  it('returns count of 1 when user has 3 source rows for the same game', async () => {
    // DISTINCT_USER_COUNT already collapses at DB — DB returns count=1
    const db = buildBatchDb([{ gameId: 10, count: 1 }], [{ gameId: 10 }]);
    const result = await batchCheckInterests(db as never, [10], 7);
    expect(result['10'].count).toBe(1);
  });

  it('returns wantToPlay: true when user has an interest row for the game', async () => {
    const db = buildBatchDb([{ gameId: 5, count: 3 }], [{ gameId: 5 }]);
    const result = await batchCheckInterests(db as never, [5], 42);
    expect(result['5'].wantToPlay).toBe(true);
  });

  it('returns wantToPlay: false when user has no interest row for the game', async () => {
    const db = buildBatchDb(
      [{ gameId: 5, count: 2 }],
      [], // user not interested
    );
    const result = await batchCheckInterests(db as never, [5], 42);
    expect(result['5'].wantToPlay).toBe(false);
  });

  it('returns count: 0 and wantToPlay: false for a game with no interests', async () => {
    const db = buildBatchDb([], []);
    const result = await batchCheckInterests(db as never, [999], 1);
    expect(result['999'].count).toBe(0);
    expect(result['999'].wantToPlay).toBe(false);
  });

  it('returns entries for every requested gameId, even if no counts exist', async () => {
    const db = buildBatchDb([], []);
    const result = await batchCheckInterests(db as never, [1, 2, 3], 99);
    expect(Object.keys(result).sort()).toEqual(['1', '2', '3']);
    for (const key of ['1', '2', '3']) {
      expect(result[key].count).toBe(0);
      expect(result[key].wantToPlay).toBe(false);
    }
  });

  it('handles multiple games with mixed interest states', async () => {
    const db = buildBatchDb(
      [
        { gameId: 10, count: 2 },
        { gameId: 20, count: 0 },
      ],
      [{ gameId: 10 }],
    );
    const result = await batchCheckInterests(db as never, [10, 20], 5);
    expect(result['10'].wantToPlay).toBe(true);
    expect(result['10'].count).toBe(2);
    expect(result['20'].wantToPlay).toBe(false);
    expect(result['20'].count).toBe(0);
  });
});
