/**
 * Unit tests for Common Ground scoring helpers (ROK-934).
 */
import {
  computeScore,
  mapCommonGroundRow,
} from './common-ground-query.helpers';
import type { CommonGroundRow } from './common-ground-query.helpers';

describe('computeScore', () => {
  it('applies OWNER_WEIGHT * ownerCount with SALE_BONUS when on sale', () => {
    // 3 owners, on sale (cut > 0) → (3*10) + 5 = 35
    expect(computeScore(3, 30)).toBe(35);
  });

  it('applies FULL_PRICE_PENALTY when not on sale (cut = 0)', () => {
    // 4 owners, full price → (4*10) - 2 = 38
    expect(computeScore(4, 0)).toBe(38);
  });

  it('applies FULL_PRICE_PENALTY when cut is null', () => {
    // 2 owners, null cut → (2*10) - 2 = 18
    expect(computeScore(2, null)).toBe(18);
  });

  it('returns SALE_BONUS - 0 for 0 owners on sale', () => {
    // 0 owners, on sale → (0*10) + 5 = 5
    expect(computeScore(0, 50)).toBe(5);
  });

  it('returns negative for 0 owners at full price', () => {
    // 0 owners, full price → (0*10) - 2 = -2
    expect(computeScore(0, null)).toBe(-2);
  });

  it('handles max cut (100%) as on-sale', () => {
    expect(computeScore(1, 100)).toBe(15);
  });

  it('orders games correctly by score', () => {
    const highOwners = computeScore(5, 0); // 48
    const lowOwnersSale = computeScore(2, 50); // 25
    expect(highOwners).toBeGreaterThan(lowOwnersSale);
  });
});

describe('mapCommonGroundRow', () => {
  const baseRow: CommonGroundRow = {
    gameId: 1,
    gameName: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    ownerCount: 3,
    wishlistCount: 1,
    nonOwnerPrice: 9.99,
    itadCurrentCut: 50,
    itadCurrentShop: 'Steam',
    itadCurrentUrl: 'https://example.com',
    earlyAccess: false,
    itadTags: ['RPG'],
    playerCount: { min: 1, max: 4 },
  };

  it('includes computed score in mapped result', () => {
    const result = mapCommonGroundRow(baseRow);
    expect(result.score).toBe(35); // (3*10) + 5
  });

  it('preserves all fields from the row', () => {
    const result = mapCommonGroundRow(baseRow);
    expect(result.gameId).toBe(1);
    expect(result.gameName).toBe('Test Game');
    expect(result.ownerCount).toBe(3);
    expect(result.wishlistCount).toBe(1);
    expect(result.earlyAccess).toBe(false);
  });

  it('handles null itadCurrentCut with penalty', () => {
    const row = { ...baseRow, itadCurrentCut: null };
    const result = mapCommonGroundRow(row);
    expect(result.score).toBe(28); // (3*10) - 2
  });
});
