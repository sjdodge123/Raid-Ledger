/**
 * Unit tests for fetchBatchGamePricing (ROK-800).
 * Covers batch ITAD ID lookup, batch overview fetch, mapping,
 * and graceful degradation for missing entries.
 */
import {
  fetchBatchGamePricing,
  mapDbRowToPricing,
} from './igdb-pricing.helpers';
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

/**
 * Build a DB mock that returns itad ID rows from batch lookup,
 * then empty cache rows from the second query.
 */
function buildBatchDb(rows: ItadIdRow[]): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]); // no cached pricing
  return db;
}

/** Build a DB mock supporting two sequential select chains. */
function buildCacheDb(
  idRows: ItadIdRow[],
  cacheRows: CachedPricingRow[],
): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest
    .fn()
    .mockResolvedValueOnce(idRows)
    .mockResolvedValueOnce(cacheRows);
  return db;
}

/** Shape of a cached pricing row from the DB. */
interface CachedPricingRow {
  id: number;
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
  itadPriceUpdatedAt: Date;
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

// ─── mapDbRowToPricing — unit tests ─────────────────────────────────────────

describe('mapDbRowToPricing', () => {
  it('maps a cached DB row with current deal to ItadGamePricingDto', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '9.99',
      itadCurrentCut: 75,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://steam.com/app/1',
      itadLowestPrice: '4.99',
      itadLowestCut: 88,
    });

    expect(result).toMatchObject({
      currentBest: {
        shop: 'Steam',
        price: 9.99,
        regularPrice: null,
        discount: 75,
      },
      historyLow: { price: 4.99, shop: null, date: null },
      currency: 'USD',
    });
  });

  it('returns null when both current and lowest are absent', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentShop: null,
      itadCurrentUrl: null,
      itadLowestPrice: null,
      itadLowestCut: null,
    });
    expect(result).toBeNull();
  });

  it('returns historyLow only when current is null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentShop: null,
      itadCurrentUrl: null,
      itadLowestPrice: '2.99',
      itadLowestCut: 90,
    });

    expect(result).not.toBeNull();
    expect(result!.currentBest).toBeNull();
    expect(result!.historyLow).toMatchObject({ price: 2.99 });
  });

  it('sets regularPrice, historyLow.shop, historyLow.date to null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '19.99',
      itadCurrentCut: 50,
      itadCurrentShop: 'GOG',
      itadCurrentUrl: 'https://gog.com',
      itadLowestPrice: '9.99',
      itadLowestCut: 75,
    });

    expect(result!.currentBest!.regularPrice).toBeNull();
    expect(result!.historyLow!.shop).toBeNull();
    expect(result!.historyLow!.date).toBeNull();
  });
});

// ─── mapDbRowToPricing — adversarial edge cases (ROK-854) ────────────────────

describe('mapDbRowToPricing — adversarial edge cases', () => {
  it('maps a free game (price=0.00) without treating it as null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '0.00',
      itadCurrentCut: 0,
      itadCurrentShop: 'itch.io',
      itadCurrentUrl: 'https://itch.io/game/free-game',
      itadLowestPrice: null,
      itadLowestCut: null,
    });

    // A free game has a real current deal (price=0) — should NOT return null
    expect(result).not.toBeNull();
    expect(result!.currentBest).not.toBeNull();
    expect(result!.currentBest!.price).toBe(0);
    expect(result!.currentBest!.shop).toBe('itch.io');
  });

  it('uses "Unknown" shop default when itadCurrentShop is null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '9.99',
      itadCurrentCut: 50,
      itadCurrentShop: null,
      itadCurrentUrl: 'https://store.steampowered.com/app/1',
      itadLowestPrice: null,
      itadLowestCut: null,
    });

    expect(result!.currentBest!.shop).toBe('Unknown');
  });

  it('uses empty string url default when itadCurrentUrl is null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '14.99',
      itadCurrentCut: 25,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: null,
      itadLowestPrice: null,
      itadLowestCut: null,
    });

    expect(result!.currentBest!.url).toBe('');
  });

  it('returns null for historyLow when itadLowestPrice is null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '29.99',
      itadCurrentCut: 40,
      itadCurrentShop: 'GOG',
      itadCurrentUrl: 'https://gog.com',
      itadLowestPrice: null,
      itadLowestCut: null,
    });

    expect(result!.historyLow).toBeNull();
  });

  it('always sets regularPrice to null (not stored in DB cache)', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '9.99',
      itadCurrentCut: 75,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://steam.com',
      itadLowestPrice: '4.99',
      itadLowestCut: 88,
    });

    expect(result!.currentBest!.regularPrice).toBeNull();
  });

  it('always sets historyLow.shop and historyLow.date to null (not in DB cache)', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentShop: null,
      itadCurrentUrl: null,
      itadLowestPrice: '2.49',
      itadLowestCut: 92,
    });

    expect(result!.historyLow!.shop).toBeNull();
    expect(result!.historyLow!.date).toBeNull();
  });

  it('uses discount=0 default when itadCurrentCut is null', () => {
    const result = mapDbRowToPricing({
      itadCurrentPrice: '9.99',
      itadCurrentCut: null,
      itadCurrentShop: 'Humble',
      itadCurrentUrl: 'https://humble.com',
      itadLowestPrice: null,
      itadLowestCut: null,
    });

    expect(result!.currentBest!.discount).toBe(0);
  });
});

// ─── fetchBatchGamePricing — DB cache path ──────────────────────────────────

describe('fetchBatchGamePricing — DB cache path', () => {
  it('reads from DB cache for games with itad_price_updated_at', async () => {
    const cachedRow: CachedPricingRow = {
      id: 1,
      itadCurrentPrice: '9.99',
      itadCurrentCut: 75,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://steam.com',
      itadLowestPrice: '4.99',
      itadLowestCut: 88,
      itadPriceUpdatedAt: new Date(),
    };
    const db = buildCacheDb(
      [{ id: 1, itadGameId: 'itad-game-1' }],
      [cachedRow],
    );
    const svc = buildBatchPriceService([]);

    const result = await fetchBatchGamePricing(db as never, svc as never, [1]);

    expect(result['1']).toMatchObject({
      currentBest: expect.objectContaining({ price: 9.99 }),
    });
    // Should NOT call ITAD API for cached games
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('falls back to ITAD API for uncached games', async () => {
    const db = buildCacheDb(
      [
        { id: 1, itadGameId: 'itad-game-1' },
        { id: 2, itadGameId: 'itad-game-2' },
      ],
      [], // no cached data
    );
    const svc = buildBatchPriceService([ENTRY_1, ENTRY_2]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [1, 2],
    );

    expect(result['1']!.currentBest!.shop).toBe('Steam');
    expect(result['2']!.currentBest!.shop).toBe('GOG');
    expect(svc.getOverviewBatch).toHaveBeenCalled();
  });

  it('merges cached and API results for mixed games', async () => {
    const cachedRow: CachedPricingRow = {
      id: 1,
      itadCurrentPrice: '9.99',
      itadCurrentCut: 75,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://steam.com',
      itadLowestPrice: null,
      itadLowestCut: null,
      itadPriceUpdatedAt: new Date(),
    };
    const db = buildCacheDb(
      [
        { id: 1, itadGameId: 'itad-game-1' },
        { id: 2, itadGameId: 'itad-game-2' },
      ],
      [cachedRow], // only game 1 cached
    );
    const svc = buildBatchPriceService([ENTRY_2]);

    const result = await fetchBatchGamePricing(
      db as never,
      svc as never,
      [1, 2],
    );

    // Game 1 from cache
    expect(result['1']!.currentBest!.price).toBe(9.99);
    // Game 2 from API
    expect(result['2']!.currentBest!.shop).toBe('GOG');
  });
});
