/**
 * Unit tests for steam-wishlist.helpers — pure diff logic (ROK-418).
 */
import {
  computeWishlistDiff,
  type WishlistDiffInput,
} from './steam-wishlist.helpers';

describe('computeWishlistDiff', () => {
  it('identifies new games to insert', () => {
    const input: WishlistDiffInput = {
      steamItems: [{ appid: 100, date_added: 1000 }],
      matchedGames: [{ id: 1, steamAppId: 100 }],
      existingGameIds: new Set(),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(1);
    expect(result.toInsert[0]).toMatchObject({
      userId: 42,
      gameId: 1,
      source: 'steam_wishlist',
    });
    expect(result.toRemoveGameIds).toHaveLength(0);
  });

  it('identifies games to remove (no longer wishlisted)', () => {
    const input: WishlistDiffInput = {
      steamItems: [],
      matchedGames: [],
      existingGameIds: new Set([5, 10]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toRemoveGameIds).toEqual(expect.arrayContaining([5, 10]));
    expect(result.toRemoveGameIds).toHaveLength(2);
  });

  it('skips games already in wishlist interests', () => {
    const input: WishlistDiffInput = {
      steamItems: [{ appid: 100, date_added: 1000 }],
      matchedGames: [{ id: 1, steamAppId: 100 }],
      existingGameIds: new Set([1]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toRemoveGameIds).toHaveLength(0);
  });

  it('skips unmatched steam items (no DB game)', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 100, date_added: 1000 },
        { appid: 999, date_added: 2000 },
      ],
      matchedGames: [{ id: 1, steamAppId: 100 }],
      existingGameIds: new Set(),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(1);
    expect(result.toInsert[0].gameId).toBe(1);
  });

  it('handles combined insert and remove scenario', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 200, date_added: 1000 },
        { appid: 300, date_added: 2000 },
      ],
      matchedGames: [
        { id: 2, steamAppId: 200 },
        { id: 3, steamAppId: 300 },
      ],
      existingGameIds: new Set([1, 3]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    // game 2 (appid 200) is new
    expect(result.toInsert).toHaveLength(1);
    expect(result.toInsert[0].gameId).toBe(2);
    // game 1 is no longer wishlisted
    expect(result.toRemoveGameIds).toEqual([1]);
  });

  it('returns empty insert and remove for empty inputs', () => {
    const input: WishlistDiffInput = {
      steamItems: [],
      matchedGames: [],
      existingGameIds: new Set(),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toRemoveGameIds).toHaveLength(0);
  });

  it('sets lastSyncedAt to a recent Date on inserts', () => {
    const before = new Date();
    const input: WishlistDiffInput = {
      steamItems: [{ appid: 100, date_added: 1000 }],
      matchedGames: [{ id: 1, steamAppId: 100 }],
      existingGameIds: new Set(),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert[0].lastSyncedAt).toBeInstanceOf(Date);
    expect(result.toInsert[0].lastSyncedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it('preserves userId on all inserted rows', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 100, date_added: 1000 },
        { appid: 200, date_added: 2000 },
        { appid: 300, date_added: 3000 },
      ],
      matchedGames: [
        { id: 1, steamAppId: 100 },
        { id: 2, steamAppId: 200 },
        { id: 3, steamAppId: 300 },
      ],
      existingGameIds: new Set(),
      userId: 99,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(3);
    for (const row of result.toInsert) {
      expect(row.userId).toBe(99);
      expect(row.source).toBe('steam_wishlist');
    }
  });

  it('handles all games already existing (no-op sync)', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 100, date_added: 1000 },
        { appid: 200, date_added: 2000 },
      ],
      matchedGames: [
        { id: 1, steamAppId: 100 },
        { id: 2, steamAppId: 200 },
      ],
      existingGameIds: new Set([1, 2]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toRemoveGameIds).toHaveLength(0);
  });

  it('handles all existing games being removed', () => {
    const input: WishlistDiffInput = {
      steamItems: [{ appid: 999, date_added: 1000 }],
      matchedGames: [],
      existingGameIds: new Set([1, 2, 3]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toRemoveGameIds).toHaveLength(3);
    expect(result.toRemoveGameIds).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('handles duplicate appids in steamItems gracefully', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 100, date_added: 1000 },
        { appid: 100, date_added: 2000 },
      ],
      matchedGames: [{ id: 1, steamAppId: 100 }],
      existingGameIds: new Set(),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    // The second duplicate should still try to insert (the DB will handle dedup via onConflictDoNothing)
    // but the game won't be in toRemoveGameIds since it's current
    expect(result.toRemoveGameIds).toHaveLength(0);
  });

  it('does not remove games that are still in the current wishlist', () => {
    const input: WishlistDiffInput = {
      steamItems: [
        { appid: 100, date_added: 1000 },
        { appid: 200, date_added: 2000 },
      ],
      matchedGames: [
        { id: 1, steamAppId: 100 },
        { id: 2, steamAppId: 200 },
      ],
      existingGameIds: new Set([1]),
      userId: 42,
    };

    const result = computeWishlistDiff(input);

    // game 2 is new, game 1 is existing and still current
    expect(result.toInsert).toHaveLength(1);
    expect(result.toInsert[0].gameId).toBe(2);
    expect(result.toRemoveGameIds).toHaveLength(0);
  });
});
