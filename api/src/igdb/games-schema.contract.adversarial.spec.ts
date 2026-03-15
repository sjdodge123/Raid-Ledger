/**
 * Adversarial contract tests for GameDetailSchema pricing fields (ROK-818).
 * Verifies that the Zod schema correctly accepts, rejects, and coerces
 * the 7 new ITAD pricing fields added to GameDetailSchema.
 */
import { GameDetailSchema } from '@raid-ledger/contract';

/** Minimal valid GameDetailDto payload (non-ITAD fields only). */
function baseDto(): Record<string, unknown> {
  return {
    id: 1,
    igdbId: 100,
    name: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    genres: [],
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
    crossplay: null,
  };
}

describe('GameDetailSchema — ITAD pricing fields (ROK-818 contract)', () => {
  describe('schema accepts valid payloads', () => {
    it('parses a DTO with all pricing fields omitted (all optional)', () => {
      const result = GameDetailSchema.safeParse(baseDto());

      expect(result.success).toBe(true);
    });

    it('parses a DTO with all 7 pricing fields set to null', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        itadLowestPrice: null,
        itadLowestCut: null,
        itadPriceUpdatedAt: null,
      });

      expect(result.success).toBe(true);
    });

    it('parses a DTO with all 7 pricing fields populated', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: 9.99,
        itadCurrentCut: 75,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.steampowered.com/app/1',
        itadLowestPrice: 4.99,
        itadLowestCut: 88,
        itadPriceUpdatedAt: '2026-03-15T12:00:00.000Z',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.itadCurrentPrice).toBe(9.99);
        expect(result.data.itadCurrentCut).toBe(75);
        expect(result.data.itadCurrentShop).toBe('Steam');
        expect(result.data.itadLowestPrice).toBe(4.99);
        expect(result.data.itadLowestCut).toBe(88);
        expect(result.data.itadPriceUpdatedAt).toBe(
          '2026-03-15T12:00:00.000Z',
        );
      }
    });

    it('accepts itadCurrentPrice of 0 (free game)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: 0,
        itadCurrentCut: 100,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.itadCurrentPrice).toBe(0);
      }
    });

    it('accepts itadCurrentCut of 0 (no discount)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentCut: 0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.itadCurrentCut).toBe(0);
      }
    });

    it('accepts itadLowestPrice of 0 (historically free)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadLowestPrice: 0,
        itadLowestCut: 100,
      });

      expect(result.success).toBe(true);
    });

    it('accepts a mix of null and populated pricing fields', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: 14.99,
        itadCurrentCut: 50,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        itadLowestPrice: null,
        itadLowestCut: null,
        itadPriceUpdatedAt: null,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('schema rejects invalid payloads', () => {
    it('rejects itadCurrentPrice as a string (must be number or null)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: '9.99',
      });

      expect(result.success).toBe(false);
    });

    it('rejects itadCurrentCut as a string', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentCut: '75',
      });

      expect(result.success).toBe(false);
    });

    it('rejects itadLowestPrice as a string', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadLowestPrice: '4.99',
      });

      expect(result.success).toBe(false);
    });

    it('rejects itadLowestCut as a string', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadLowestCut: '88',
      });

      expect(result.success).toBe(false);
    });

    it('rejects itadCurrentShop as a number (must be string or null)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentShop: 42,
      });

      expect(result.success).toBe(false);
    });

    it('rejects itadPriceUpdatedAt as a Date object (must be string or null)', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadPriceUpdatedAt: new Date('2026-03-15T12:00:00.000Z'),
      });

      // Zod z.string() does not accept a Date object
      expect(result.success).toBe(false);
    });
  });

  describe('schema field-level output shapes', () => {
    it('outputs undefined for omitted optional pricing fields', () => {
      const result = GameDetailSchema.safeParse(baseDto());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.itadCurrentPrice).toBeUndefined();
        expect(result.data.itadCurrentCut).toBeUndefined();
        expect(result.data.itadCurrentShop).toBeUndefined();
        expect(result.data.itadCurrentUrl).toBeUndefined();
        expect(result.data.itadLowestPrice).toBeUndefined();
        expect(result.data.itadLowestCut).toBeUndefined();
        expect(result.data.itadPriceUpdatedAt).toBeUndefined();
      }
    });

    it('preserves exact numeric value for itadCurrentPrice', () => {
      const result = GameDetailSchema.safeParse({
        ...baseDto(),
        itadCurrentPrice: 1.5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.itadCurrentPrice).toBe(1.5);
      }
    });
  });
});
