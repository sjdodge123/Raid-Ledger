/**
 * Tests for igdb.mappers.ts — mapDbRowToDetail pricing field mapping (ROK-818).
 */
import { mapDbRowToDetail } from './igdb.mappers';
import type { games } from '../drizzle/schema';

type GameRow = typeof games.$inferSelect;

/** Build a minimal game row with sensible defaults. */
function buildGameRow(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 1,
    igdbId: 100,
    name: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    genres: [],
    cachedAt: new Date(),
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    steamAppId: null,
    crossplay: null,
    hidden: false,
    banned: false,
    shortName: null,
    colorHex: null,
    hasRoles: false,
    hasSpecs: false,
    enabled: true,
    itadGameId: null,
    itadBoxartUrl: null,
    itadTags: [],
    maxCharactersPerUser: 10,
    apiNamespacePrefix: null,
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
    ...overrides,
  } as GameRow;
}

describe('mapDbRowToDetail — ITAD pricing fields (ROK-818)', () => {
  it('maps null pricing fields when no ITAD data', () => {
    const row = buildGameRow();
    const result = mapDbRowToDetail(row);

    expect(result.itadCurrentPrice).toBeNull();
    expect(result.itadCurrentCut).toBeNull();
    expect(result.itadCurrentShop).toBeNull();
    expect(result.itadCurrentUrl).toBeNull();
    expect(result.itadLowestPrice).toBeNull();
    expect(result.itadLowestCut).toBeNull();
    expect(result.itadPriceUpdatedAt).toBeNull();
  });

  it('casts numeric price strings to numbers', () => {
    const row = buildGameRow({
      itadCurrentPrice: '9.99',
      itadLowestPrice: '4.99',
    });
    const result = mapDbRowToDetail(row);

    expect(result.itadCurrentPrice).toBe(9.99);
    expect(result.itadLowestPrice).toBe(4.99);
  });

  it('maps integer and text pricing fields directly', () => {
    const row = buildGameRow({
      itadCurrentCut: 75,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://store.steampowered.com/app/123',
      itadLowestCut: 90,
    });
    const result = mapDbRowToDetail(row);

    expect(result.itadCurrentCut).toBe(75);
    expect(result.itadCurrentShop).toBe('Steam');
    expect(result.itadCurrentUrl).toBe(
      'https://store.steampowered.com/app/123',
    );
    expect(result.itadLowestCut).toBe(90);
  });

  it('converts itadPriceUpdatedAt Date to ISO string', () => {
    const date = new Date('2026-03-15T12:00:00.000Z');
    const row = buildGameRow({ itadPriceUpdatedAt: date });
    const result = mapDbRowToDetail(row);

    expect(result.itadPriceUpdatedAt).toBe('2026-03-15T12:00:00.000Z');
  });

  it('handles zero price (free game deal)', () => {
    const row = buildGameRow({
      itadCurrentPrice: '0.00',
      itadCurrentCut: 100,
    });
    const result = mapDbRowToDetail(row);

    // '0.00' is falsy as a string — ensure it maps to 0 not null
    expect(result.itadCurrentPrice).toBe(0);
    expect(result.itadCurrentCut).toBe(100);
  });
});
