/**
 * Unit tests for fetchBatchGamePricing.
 * ROK-800: original cache + ITAD-fallback semantics.
 * ROK-1047: ITAD is no longer called synchronously; uncached and stale
 *   rows return null, and the optional enqueue callback is invoked once
 *   per uncached game with an ITAD id.
 */
import {
  fetchBatchGamePricing,
  mapDbRowToPricing,
} from './igdb-pricing.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import { PRICING_STALE_MS } from '../itad/itad-price-sync.constants';

// ─── Mock helpers ────────────────────────────────────────────────────────────

type ItadIdRow = { id: number; itadGameId: string | null };

interface CachedPricingRow {
  id: number;
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
  itadPriceUpdatedAt: Date | string | null;
}

/** Build a DB mock supporting two sequential select chains. */
function buildDb(
  idRows: ItadIdRow[],
  cacheRows: CachedPricingRow[] = [],
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

const itadStub: Pick<ItadPriceService, 'getOverviewBatch'> = {
  getOverviewBatch: jest.fn().mockResolvedValue([]),
};

// ─── fetchBatchGamePricing — ROK-1047 async-fetch behavior ──────────────────

describe('fetchBatchGamePricing — ROK-1047', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty object when gameIds is empty', async () => {
    const db = buildDb([]);
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [],
      enqueue,
    );

    expect(result).toEqual({});
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does NOT call getOverviewBatch on cache miss', async () => {
    const db = buildDb([{ id: 1, itadGameId: 'itad-1' }], []);
    const overviewBatch = jest.fn();

    await fetchBatchGamePricing(
      db as never,
      { getOverviewBatch: overviewBatch } as never,
      [1],
    );

    expect(overviewBatch).not.toHaveBeenCalled();
  });

  it('returns null for uncached games', async () => {
    const db = buildDb([{ id: 1, itadGameId: 'itad-1' }], []);

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
    );

    expect(result['1']).toBeNull();
  });

  it('calls enqueue once per uncached game with an ITAD id', async () => {
    const db = buildDb(
      [
        { id: 1, itadGameId: 'itad-1' },
        { id: 2, itadGameId: 'itad-2' },
      ],
      [],
    );
    const enqueue = jest.fn();

    await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1, 2],
      enqueue,
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(1);
    expect(enqueue).toHaveBeenCalledWith(2);
  });

  it('does not enqueue games without ITAD id', async () => {
    const db = buildDb([{ id: 1, itadGameId: null }], []);
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
      enqueue,
    );

    expect(result['1']).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues stale cache rows (older than PRICING_STALE_MS)', async () => {
    const stale = new Date(Date.now() - PRICING_STALE_MS - 1000);
    const db = buildDb(
      [{ id: 1, itadGameId: 'itad-1' }],
      [
        {
          id: 1,
          itadCurrentPrice: '9.99',
          itadCurrentCut: 50,
          itadCurrentShop: 'Steam',
          itadCurrentUrl: 'https://steam.com',
          itadLowestPrice: '4.99',
          itadLowestCut: 75,
          itadPriceUpdatedAt: stale,
        },
      ],
    );
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
      enqueue,
    );

    expect(result['1']).toBeNull();
    expect(enqueue).toHaveBeenCalledWith(1);
  });

  it('does not enqueue when row is fresh (within PRICING_STALE_MS)', async () => {
    const fresh = new Date();
    const db = buildDb(
      [{ id: 1, itadGameId: 'itad-1' }],
      [
        {
          id: 1,
          itadCurrentPrice: '9.99',
          itadCurrentCut: 50,
          itadCurrentShop: 'Steam',
          itadCurrentUrl: 'https://steam.com',
          itadLowestPrice: null,
          itadLowestCut: null,
          itadPriceUpdatedAt: fresh,
        },
      ],
    );
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
      enqueue,
    );

    expect(result['1']).toMatchObject({
      currentBest: expect.objectContaining({ price: 9.99 }),
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('omitting enqueue callback is allowed (no throw)', async () => {
    const db = buildDb([{ id: 1, itadGameId: 'itad-1' }], []);

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
    );

    expect(result['1']).toBeNull();
  });

  it('handles mixed: cached fresh, uncached, no-itad — only uncached-with-itad enqueues', async () => {
    const fresh = new Date();
    const db = buildDb(
      [
        { id: 1, itadGameId: 'itad-1' },
        { id: 2, itadGameId: 'itad-2' },
        { id: 3, itadGameId: null },
      ],
      [
        {
          id: 1,
          itadCurrentPrice: '9.99',
          itadCurrentCut: 50,
          itadCurrentShop: 'Steam',
          itadCurrentUrl: 'https://steam.com',
          itadLowestPrice: null,
          itadLowestCut: null,
          itadPriceUpdatedAt: fresh,
        },
      ],
    );
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1, 2, 3],
      enqueue,
    );

    expect(result['1']).toBeTruthy();
    expect(result['2']).toBeNull();
    expect(result['3']).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(2);
  });

  it('accepts ISO-string itadPriceUpdatedAt as fresh', async () => {
    const db = buildDb(
      [{ id: 1, itadGameId: 'itad-1' }],
      [
        {
          id: 1,
          itadCurrentPrice: '9.99',
          itadCurrentCut: 50,
          itadCurrentShop: 'Steam',
          itadCurrentUrl: 'https://steam.com',
          itadLowestPrice: null,
          itadLowestCut: null,
          itadPriceUpdatedAt: new Date().toISOString(),
        },
      ],
    );
    const enqueue = jest.fn();

    const result = await fetchBatchGamePricing(
      db as never,
      itadStub as never,
      [1],
      enqueue,
    );

    expect(result['1']).toBeTruthy();
    expect(enqueue).not.toHaveBeenCalled();
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
