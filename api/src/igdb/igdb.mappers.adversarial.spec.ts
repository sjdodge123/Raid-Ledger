/**
 * Adversarial tests for igdb.mappers.ts — ITAD pricing field mapping (ROK-818).
 * Covers edge cases the dev's initial tests missed:
 * - Numeric conversion edge cases ('0', '0.00', floating point strings)
 * - itadTags null fallback to empty array
 * - itadBoxartUrl passthrough
 * - itadPriceUpdatedAt with various Date values
 * - Full pricing row included in mapDbRowToDetail output shape
 * - Non-pricing fields unaffected by ITAD data presence
 */
import { mapDbRowToDetail } from './igdb.mappers';
import type { games } from '../drizzle/schema';

type GameRow = typeof games.$inferSelect;

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

describe('mapDbRowToDetail — adversarial ITAD pricing edge cases (ROK-818)', () => {
  describe('itadCurrentPrice numeric conversion', () => {
    it('converts "0.00" string to number 0, not null (free game deal)', () => {
      const row = buildGameRow({ itadCurrentPrice: '0.00' });
      const result = mapDbRowToDetail(row);

      // '0.00' is non-null — must NOT become null
      expect(result.itadCurrentPrice).toBe(0);
      expect(result.itadCurrentPrice).not.toBeNull();
    });

    it('converts "0" string to number 0', () => {
      const row = buildGameRow({ itadCurrentPrice: '0' });
      const result = mapDbRowToDetail(row);

      expect(result.itadCurrentPrice).toBe(0);
    });

    it('converts "0.10" string to 0.1 without floating point corruption', () => {
      const row = buildGameRow({ itadCurrentPrice: '0.10' });
      const result = mapDbRowToDetail(row);

      // Number('0.10') === 0.1 (exact representation)
      expect(result.itadCurrentPrice).toBe(0.1);
    });

    it('converts "99.99" to 99.99', () => {
      const row = buildGameRow({
        itadCurrentPrice: '99.99',
        itadLowestPrice: '49.99',
      });
      const result = mapDbRowToDetail(row);

      expect(result.itadCurrentPrice).toBe(99.99);
      expect(result.itadLowestPrice).toBe(49.99);
    });
  });

  describe('itadLowestPrice numeric conversion', () => {
    it('converts "0.00" lowest price to 0, not null', () => {
      const row = buildGameRow({ itadLowestPrice: '0.00' });
      const result = mapDbRowToDetail(row);

      expect(result.itadLowestPrice).toBe(0);
      expect(result.itadLowestPrice).not.toBeNull();
    });

    it('returns null when itadLowestPrice is null', () => {
      const row = buildGameRow({ itadLowestPrice: null });
      const result = mapDbRowToDetail(row);

      expect(result.itadLowestPrice).toBeNull();
    });
  });

  describe('itadTags null safety', () => {
    it('returns empty array when itadTags is null', () => {
      const row = buildGameRow({ itadTags: null as unknown as string[] });
      const result = mapDbRowToDetail(row);

      expect(result.itadTags).toEqual([]);
    });

    it('returns the tags array when itadTags has values', () => {
      const row = buildGameRow({ itadTags: ['RPG', 'Action', 'Open World'] });
      const result = mapDbRowToDetail(row);

      expect(result.itadTags).toEqual(['RPG', 'Action', 'Open World']);
    });
  });

  describe('itadBoxartUrl passthrough', () => {
    it('returns the itadBoxartUrl string when present', () => {
      const url = 'https://cdn.fanatical.com/production/boxart/game.jpg';
      const row = buildGameRow({ itadBoxartUrl: url });
      const result = mapDbRowToDetail(row);

      expect(result.itadBoxartUrl).toBe(url);
    });

    it('returns null when itadBoxartUrl is null', () => {
      const row = buildGameRow({ itadBoxartUrl: null });
      const result = mapDbRowToDetail(row);

      expect(result.itadBoxartUrl).toBeNull();
    });
  });

  describe('itadPriceUpdatedAt ISO conversion', () => {
    it('returns null when itadPriceUpdatedAt is null', () => {
      const row = buildGameRow({ itadPriceUpdatedAt: null });
      const result = mapDbRowToDetail(row);

      expect(result.itadPriceUpdatedAt).toBeNull();
    });

    it('converts epoch start date correctly', () => {
      const epoch = new Date(0);
      const row = buildGameRow({ itadPriceUpdatedAt: epoch });
      const result = mapDbRowToDetail(row);

      expect(result.itadPriceUpdatedAt).toBe('1970-01-01T00:00:00.000Z');
    });

    it('preserves millisecond precision in ISO output', () => {
      const precise = new Date('2026-03-15T08:30:45.123Z');
      const row = buildGameRow({ itadPriceUpdatedAt: precise });
      const result = mapDbRowToDetail(row);

      expect(result.itadPriceUpdatedAt).toBe('2026-03-15T08:30:45.123Z');
    });
  });

  describe('itadCurrentCut edge values', () => {
    it('returns 0 when cut is 0 (no discount)', () => {
      const row = buildGameRow({ itadCurrentCut: 0 });
      const result = mapDbRowToDetail(row);

      expect(result.itadCurrentCut).toBe(0);
    });

    it('returns 100 when cut is 100 (free)', () => {
      const row = buildGameRow({ itadCurrentCut: 100 });
      const result = mapDbRowToDetail(row);

      expect(result.itadCurrentCut).toBe(100);
    });

    it('returns null when cut is null', () => {
      const row = buildGameRow({ itadCurrentCut: null });
      const result = mapDbRowToDetail(row);

      expect(result.itadCurrentCut).toBeNull();
    });
  });

  describe('full ITAD pricing row in output', () => {
    it('includes all 7 ITAD pricing fields in the DTO', () => {
      const updatedAt = new Date('2026-03-01T00:00:00.000Z');
      const row = buildGameRow({
        itadGameId: 'uuid-game-1',
        itadCurrentPrice: '14.99',
        itadCurrentCut: 50,
        itadCurrentShop: 'GOG',
        itadCurrentUrl: 'https://gog.com/game/1',
        itadLowestPrice: '9.99',
        itadLowestCut: 75,
        itadPriceUpdatedAt: updatedAt,
      });
      const result = mapDbRowToDetail(row);

      expect(result).toMatchObject({
        itadGameId: 'uuid-game-1',
        itadCurrentPrice: 14.99,
        itadCurrentCut: 50,
        itadCurrentShop: 'GOG',
        itadCurrentUrl: 'https://gog.com/game/1',
        itadLowestPrice: 9.99,
        itadLowestCut: 75,
        itadPriceUpdatedAt: '2026-03-01T00:00:00.000Z',
      });
    });

    it('does not corrupt non-pricing fields when pricing is populated', () => {
      const row = buildGameRow({
        id: 42,
        name: 'Cyberpunk 2077',
        slug: 'cyberpunk-2077',
        itadCurrentPrice: '9.99',
        itadCurrentCut: 80,
      });
      const result = mapDbRowToDetail(row);

      expect(result.id).toBe(42);
      expect(result.name).toBe('Cyberpunk 2077');
      expect(result.slug).toBe('cyberpunk-2077');
    });
  });
});
