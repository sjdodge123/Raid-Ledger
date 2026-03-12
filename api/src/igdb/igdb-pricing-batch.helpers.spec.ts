/**
 * Unit tests for fetchBatchGamePricing (ROK-800).
 * Covers batch ITAD ID lookup, batch overview fetch, mapping,
 * and graceful degradation for missing entries.
 */
import { fetchBatchGamePricing } from './igdb-pricing.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ENTRY_1: ItadOverviewGameEntry = {
  id: 'itad-game-1',
  current: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 50,
    url: 'https://store.steampowered.com/app/111',
  },
  lowest: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 75,
    timestamp: '2024-11-25T00:00:00Z',
  },
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/game1/' },
};

const ENTRY_2: ItadOverviewGameEntry = {
  id: 'itad-game-2',
  current: {
    shop: { id: 35, name: 'GOG' },
    price: { amount: 9.99, amountInt: 999, currency: 'USD' },
    regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
    cut: 50,
    url: 'https://gog.com/game/222',
  },
  lowest: null,
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/game2/' },
};

// ─── Mock helpers ────────────────────────────────────────────────────────────

type ItadIdRow = { id: number; itadGameId: string | null };

/** Build a DB mock that returns given itad ID rows from a batch lookup. */
function buildBatchDb(rows: ItadIdRow[]): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest.fn().mockResolvedValue(rows);
  return db;
}

/** Build a price service with getOverviewBatch support. */
function buildBatchPriceService(
  entries: ItadOverviewGameEntry[],
): Pick<ItadPriceService, 'getOverviewBatch'> {
  return {
    getOverviewBatch: jest.fn().mockResolvedValue(entries),
  };
}

// ─── fetchBatchGamePricing — empty / null paths ─────────────────────────────

describe('fetchBatchGamePricing — empty/null paths', () => {
  it('returns empty object when gameIds is empty', async () => {
    const db = buildBatchDb([]);
    const svc = buildBatchPriceService([]);

    const result = await fetchBatchGamePricing(db as never, svc as never, []);

    expect(result).toEqual({});
  });

  it('returns null for games with no ITAD ID', async () => {
    const db = buildBatchDb([{ id: 10, itadGameId: null }]);
    const svc = buildBatchPriceService([]);

    const result = await fetchBatchGamePricing(db as never, svc as never, [10]);

    expect(result['10']).toBeNull();
  });

  it('returns null for games not found in DB', async () => {
    const db = buildBatchDb([]);
    const svc = buildBatchPriceService([]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [999],
    );

    expect(result['999']).toBeNull();
  });

  it('does not call getOverviewBatch when no ITAD IDs exist', async () => {
    const db = buildBatchDb([{ id: 10, itadGameId: null }]);
    const svc = buildBatchPriceService([]);

    await fetchBatchGamePricing(db as never, svc as never, [10]);

    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });
});

// ─── fetchBatchGamePricing — batch fetch ────────────────────────────────────

describe('fetchBatchGamePricing — batch fetch', () => {
  it('returns pricing for games with ITAD IDs', async () => {
    const db = buildBatchDb([{ id: 1, itadGameId: 'itad-game-1' }]);
    const svc = buildBatchPriceService([ENTRY_1]);

    const result = await fetchBatchGamePricing(db as never, svc as never, [1]);

    expect(result['1']).toMatchObject({
      currentBest: expect.objectContaining({ shop: 'Steam' }),
      currency: 'USD',
    });
  });

  it('maps multiple games in a single batch', async () => {
    const db = buildBatchDb([
      { id: 1, itadGameId: 'itad-game-1' },
      { id: 2, itadGameId: 'itad-game-2' },
    ]);
    const svc = buildBatchPriceService([ENTRY_1, ENTRY_2]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [1, 2],
    );

    expect(result['1']).toBeTruthy();
    expect(result['2']).toBeTruthy();
    expect(result['1']!.currentBest!.shop).toBe('Steam');
    expect(result['2']!.currentBest!.shop).toBe('GOG');
  });

  it('passes ITAD game IDs to getOverviewBatch', async () => {
    const db = buildBatchDb([
      { id: 1, itadGameId: 'itad-game-1' },
      { id: 2, itadGameId: 'itad-game-2' },
    ]);
    const svc = buildBatchPriceService([ENTRY_1, ENTRY_2]);

    await fetchBatchGamePricing(db as never, svc as never, [1, 2]);

    expect(svc.getOverviewBatch).toHaveBeenCalledWith(
      expect.arrayContaining(['itad-game-1', 'itad-game-2']),
    );
  });

  it('handles mixed: some games with ITAD IDs, some without', async () => {
    const db = buildBatchDb([
      { id: 1, itadGameId: 'itad-game-1' },
      { id: 2, itadGameId: null },
    ]);
    const svc = buildBatchPriceService([ENTRY_1]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [1, 2, 3],
    );

    expect(result['1']).toBeTruthy();
    expect(result['2']).toBeNull();
    expect(result['3']).toBeNull();
  });

  it('returns null for game whose ITAD ID has no overview data', async () => {
    const db = buildBatchDb([
      { id: 1, itadGameId: 'itad-game-1' },
      { id: 2, itadGameId: 'itad-missing' },
    ]);
    const svc = buildBatchPriceService([ENTRY_1]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [1, 2],
    );

    expect(result['1']).toBeTruthy();
    expect(result['2']).toBeNull();
  });
});
