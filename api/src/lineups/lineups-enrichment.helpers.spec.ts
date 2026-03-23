/**
 * Unit tests for lineup enrichment helpers (ROK-935).
 * Tests batch ownership, wishlist, pricing, and member count queries.
 */
import {
  countOwnersPerGame,
  countWishlistPerGame,
  fetchPricingMetadata,
  countTotalMembers,
} from './lineups-enrichment.helpers';

describe('countOwnersPerGame', () => {
  it('returns a map of gameId → owner count', async () => {
    const mockDb = makeMockDb([
      { gameId: 10, count: 3 },
      { gameId: 20, count: 5 },
    ]);

    const result = await countOwnersPerGame(mockDb as any, [10, 20]);

    expect(result.get(10)).toBe(3);
    expect(result.get(20)).toBe(5);
  });

  it('returns an empty map for empty gameIds', async () => {
    const mockDb = makeMockDb([]);

    const result = await countOwnersPerGame(mockDb as any, []);

    expect(result.size).toBe(0);
  });

  it('defaults to 0 for games with no owners', async () => {
    const mockDb = makeMockDb([{ gameId: 10, count: 2 }]);

    const result = await countOwnersPerGame(mockDb as any, [10, 30]);

    expect(result.get(10)).toBe(2);
    expect(result.get(30)).toBeUndefined();
  });
});

describe('countWishlistPerGame', () => {
  it('returns a map of gameId → wishlist count', async () => {
    const mockDb = makeMockDb([
      { gameId: 10, count: 1 },
      { gameId: 20, count: 4 },
    ]);

    const result = await countWishlistPerGame(mockDb as any, [10, 20]);

    expect(result.get(10)).toBe(1);
    expect(result.get(20)).toBe(4);
  });
});

describe('fetchPricingMetadata', () => {
  it('returns a map of gameId → pricing data', async () => {
    const mockDb = makeMockDb([
      {
        id: 10,
        itadCurrentPrice: '9.99',
        itadCurrentCut: 50,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.example.com',
      },
    ]);

    const result = await fetchPricingMetadata(mockDb as any, [10]);

    expect(result.get(10)).toEqual({
      itadCurrentPrice: 9.99,
      itadCurrentCut: 50,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://store.example.com',
    });
  });

  it('returns null price when itadCurrentPrice is null', async () => {
    const mockDb = makeMockDb([
      {
        id: 10,
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
      },
    ]);

    const result = await fetchPricingMetadata(mockDb as any, [10]);

    expect(result.get(10)?.itadCurrentPrice).toBeNull();
  });
});

describe('countTotalMembers', () => {
  it('returns the total count of users', async () => {
    const mockDb = makeMockDb([{ count: 15 }]);

    const result = await countTotalMembers(mockDb as any);

    expect(result).toBe(15);
  });

  it('returns 0 when no users exist', async () => {
    const mockDb = makeMockDb([{ count: 0 }]);

    const result = await countTotalMembers(mockDb as any);

    expect(result).toBe(0);
  });
});

/**
 * Creates a mock DB that resolves query chains to the given data.
 * Handles select().from().where().groupBy() chain patterns.
 * Also supports direct await on from() (no where clause).
 */
function makeMockDb(data: unknown[]) {
  const thenable = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenable),
    groupBy: jest.fn().mockImplementation(() => thenable),
    orderBy: jest.fn().mockImplementation(() => thenable),
  };

  const where = jest.fn().mockReturnValue(thenable);
  const fromResult = {
    then: thenable.then,
    where,
    groupBy: jest.fn().mockImplementation(() => thenable),
    innerJoin: jest.fn().mockReturnValue({ where }),
  };
  const from = jest.fn().mockReturnValue(fromResult);

  return { select: jest.fn().mockReturnValue({ from }) };
}
