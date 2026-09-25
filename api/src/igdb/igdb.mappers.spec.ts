/**
 * Tests for igdb.mappers.ts — mapDbRowToDetail pricing field mapping (ROK-818)
 * and mapApiGameToDbRow's steam_app_id provenance tag (ROK-1680).
 */
import { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';
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

describe('mapApiGameToDbRow — steamAppIdSource (ROK-1680)', () => {
  const base = { id: 4242, name: 'Tagged Game', slug: 'tagged-game' };

  it("tags 'igdb' when IGDB carries a Steam external id", () => {
    const row = mapApiGameToDbRow({
      ...base,
      external_games: [{ category: 1, uid: '632360' }],
    });

    expect(row.steamAppId).toBe(632360);
    expect(row.steamAppIdSource).toBe('igdb');
  });

  it("tags 'igdb' for the external_game_source form of the Steam id", () => {
    const row = mapApiGameToDbRow({
      ...base,
      external_games: [{ external_game_source: 1, uid: '251570' }],
    });

    expect(row.steamAppId).toBe(251570);
    expect(row.steamAppIdSource).toBe('igdb');
  });

  it('leaves the source null when there is no Steam external id', () => {
    const row = mapApiGameToDbRow({
      ...base,
      external_games: [{ category: 14, uid: 'twitch-1' }],
    });

    expect(row.steamAppId).toBeNull();
    expect(row.steamAppIdSource).toBeNull();
  });

  it('leaves the source null when the Steam uid is not a number', () => {
    const row = mapApiGameToDbRow({
      ...base,
      external_games: [{ category: 1, uid: 'not-a-number' }],
    });

    expect(row.steamAppId).toBeNull();
    expect(row.steamAppIdSource).toBeNull();
  });
});
