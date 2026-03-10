/**
 * Unit tests for igdb-discover.helpers — buildDiscoverCategories
 * and fetchMostWishlistedRow (ROK-418).
 */
import {
  buildDiscoverCategories,
  fetchMostWishlistedRow,
} from './igdb-discover.helpers';

describe('buildDiscoverCategories', () => {
  it('includes "Most Wishlisted" category', () => {
    const categories = buildDiscoverCategories();
    const wishlisted = categories.find((c) => c.slug === 'most-wishlisted');
    expect(wishlisted).toBeDefined();
    expect(wishlisted!.category).toBe('Most Wishlisted');
  });

  it('"Most Wishlisted" is not cached (uses custom fetch)', () => {
    const categories = buildDiscoverCategories();
    const wishlisted = categories.find((c) => c.slug === 'most-wishlisted');
    expect(wishlisted!.cached).toBe(false);
  });

  it('"Most Wishlisted" has no filter or orderBy', () => {
    const categories = buildDiscoverCategories();
    const wishlisted = categories.find((c) => c.slug === 'most-wishlisted');
    expect(wishlisted!.filter).toBeUndefined();
    expect(wishlisted!.orderBy).toBeUndefined();
  });

  it('returns all expected category slugs', () => {
    const categories = buildDiscoverCategories();
    const slugs = categories.map((c) => c.slug);
    expect(slugs).toContain('community-wants-to-play');
    expect(slugs).toContain('most-wishlisted');
    expect(slugs).toContain('recently-released');
    expect(slugs).toContain('highest-rated');
  });

  it('returns at least 5 categories', () => {
    const categories = buildDiscoverCategories();
    expect(categories.length).toBeGreaterThanOrEqual(5);
  });
});

describe('fetchMostWishlistedRow', () => {
  function buildDiscoverDb(
    wishlistGames: { gameId: number; count: number }[],
    games: { id: number; name: string }[],
  ): Record<string, jest.Mock> {
    const db: Record<string, jest.Mock> = {};
    const chainMethods = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
    for (const m of chainMethods) {
      db[m] = jest.fn().mockReturnThis();
    }

    // First .where() call: wishlist games query (with .groupBy.orderBy.limit)
    // Second .where() call: games query (returns full game rows)
    let whereCallCount = 0;
    db.where = jest.fn().mockImplementation(() => {
      whereCallCount++;
      if (whereCallCount === 1) {
        // wishlist interests query — chain continues
        return db;
      }
      // games fetch — terminal
      return Promise.resolve(
        games.map((g) => ({
          ...g,
          slug: g.name.toLowerCase().replace(/\s+/g, '-'),
          hidden: false,
          banned: false,
        })),
      );
    });

    db.limit = jest.fn().mockResolvedValue(wishlistGames);

    return db;
  }

  it('returns empty games array when no wishlist entries exist', async () => {
    const db = buildDiscoverDb([], []);
    const cat = {
      category: 'Most Wishlisted',
      slug: 'most-wishlisted',
      cached: false,
    };

    const result = await fetchMostWishlistedRow(db as never, cat);

    expect(result.category).toBe('Most Wishlisted');
    expect(result.slug).toBe('most-wishlisted');
    expect(result.games).toEqual([]);
  });
});
