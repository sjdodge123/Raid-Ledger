/**
 * Unit tests for the digest best-price row shaping (ROK-1771 §11).
 * The SQL itself is pinned by weekly-digest-best-price.integration.spec.ts.
 */
import {
  shapeBestPriceRows,
  type BestPriceQueryRow,
} from './weekly-digest-best-price.helpers';

function row(overrides: Partial<BestPriceQueryRow> = {}): BestPriceQueryRow {
  return {
    gameId: 1,
    name: 'Deep Rock Galactic',
    slug: 'deep-rock-galactic',
    cut: 60,
    price: '11.99',
    wishlisters: 5,
    total: 1,
    ...overrides,
  };
}

describe('shapeBestPriceRows', () => {
  it('maps a row to a line with a numeric price', () => {
    expect(shapeBestPriceRows([row()])).toEqual({
      items: [
        {
          gameId: 1,
          name: 'Deep Rock Galactic',
          slug: 'deep-rock-galactic',
          cutPercent: 60,
          price: 11.99,
          wishlisters: 5,
        },
      ],
      total: 1,
    });
  });

  it('keeps query order and reads total from the window column', () => {
    const shaped = shapeBestPriceRows([
      row({ gameId: 2, total: 7 }),
      row({ gameId: 1, total: 7 }),
    ]);
    expect(shaped.items.map((l) => l.gameId)).toEqual([2, 1]);
    expect(shaped.total).toBe(7);
  });

  it('returns an empty section for no rows', () => {
    expect(shapeBestPriceRows([])).toEqual({ items: [], total: 0 });
  });

  it('drops a row whose price is null or not a number', () => {
    const shaped = shapeBestPriceRows([
      row({ gameId: 1, price: null }),
      row({ gameId: 2, price: 'n/a' }),
      row({ gameId: 3, price: '0.00' }),
    ]);
    expect(shaped.items.map((l) => [l.gameId, l.price])).toEqual([[3, 0]]);
  });
});
