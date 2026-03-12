/**
 * Unit tests for igdb-pricing.helpers (ROK-419).
 * Covers fetchGamePricing, mapping logic, deal quality computation,
 * and all graceful-degradation paths.
 */
import { fetchGamePricing } from './igdb-pricing.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewEntry } from '../itad/itad-price.types';

// ─── DB mock helpers ─────────────────────────────────────────────────────────

/** Build a DB mock that returns a specific itadGameId from the games table. */
function buildDbWithItadId(itadGameId: string | null): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest.fn().mockResolvedValue(
    itadGameId !== null ? [{ itadGameId }] : [],
  );
  return db;
}

/** Build a minimal ItadPriceService mock. */
function buildPriceService(
  overview: ItadOverviewEntry | null,
): Pick<ItadPriceService, 'getOverview'> {
  return { getOverview: jest.fn().mockResolvedValue(overview) };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STEAM_PRICE_ENTRY = {
  shop: { id: 61, name: 'Steam' },
  price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
  regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
  cut: 50,
  url: 'https://store.steampowered.com/app/12345',
};

const GOG_PRICE_ENTRY = {
  shop: { id: 35, name: 'GOG' },
  price: { amount: 39.99, amountInt: 3999, currency: 'USD' },
  regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
  cut: 33,
  url: 'https://gog.com/game/test',
};

const HISTORY_LOW = {
  price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
  shop: { id: 61, name: 'Steam' },
  recorded: '2024-11-25T00:00:00Z',
};

const OVERVIEW_SINGLE_STORE: ItadOverviewEntry = {
  prices: [STEAM_PRICE_ENTRY],
  lowest: HISTORY_LOW,
};

const OVERVIEW_MULTI_STORE: ItadOverviewEntry = {
  prices: [STEAM_PRICE_ENTRY, GOG_PRICE_ENTRY],
  lowest: HISTORY_LOW,
};

const OVERVIEW_NO_LOW: ItadOverviewEntry = {
  prices: [STEAM_PRICE_ENTRY],
  lowest: null,
};

const OVERVIEW_NO_PRICES: ItadOverviewEntry = {
  prices: [],
  lowest: null,
};

// ─── fetchGamePricing — null paths ───────────────────────────────────────────

describe('fetchGamePricing — null paths', () => {
  it('returns null when game has no ITAD ID in DB', async () => {
    const db = buildDbWithItadId(null);
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 99);

    expect(result).toBeNull();
    expect(svc.getOverview).not.toHaveBeenCalled();
  });

  it('returns null when DB returns empty rows for gameId', async () => {
    const db = buildDbWithItadId(null);
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 999);

    expect(result).toBeNull();
  });

  it('returns null when ItadPriceService returns null (unconfigured or unavailable)', async () => {
    const db = buildDbWithItadId('uuid-game-abc');
    const svc = buildPriceService(null);

    const result = await fetchGamePricing(db as never, svc as never, 42);

    expect(result).toBeNull();
  });

  it('passes correct itadGameId from DB to price service', async () => {
    const db = buildDbWithItadId('uuid-elden-ring');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    await fetchGamePricing(db as never, svc as never, 7);

    expect(svc.getOverview).toHaveBeenCalledWith('uuid-elden-ring');
  });
});

// ─── fetchGamePricing — store mapping ────────────────────────────────────────

describe('fetchGamePricing — store mapping', () => {
  it('maps store entries to contract shape with correct fields', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result).not.toBeNull();
    expect(result!.stores).toHaveLength(1);
    expect(result!.stores[0]).toMatchObject({
      shop: expect.any(String),
      url: expect.any(String),
      price: expect.any(Number),
      regularPrice: expect.any(Number),
      discount: expect.any(Number),
    });
  });

  it('maps shop name (not shop ID) to stores[].shop', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores[0].shop).toBe('Steam');
  });

  it('maps price.amount (not amountInt) to stores[].price', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores[0].price).toBe(29.99);
  });

  it('maps regular.amount to stores[].regularPrice', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores[0].regularPrice).toBe(59.99);
  });

  it('maps cut to stores[].discount', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores[0].discount).toBe(50);
  });

  it('maps all stores in multi-store overview', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_MULTI_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores).toHaveLength(2);
    const shopNames = result!.stores.map((s) => s.shop);
    expect(shopNames).toContain('Steam');
    expect(shopNames).toContain('GOG');
  });
});

// ─── fetchGamePricing — currentBest ──────────────────────────────────────────

describe('fetchGamePricing — currentBest selection', () => {
  it('selects the lowest-priced store as currentBest', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_MULTI_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    // Steam: 29.99 < GOG: 39.99
    expect(result!.currentBest).not.toBeNull();
    expect(result!.currentBest!.shop).toBe('Steam');
    expect(result!.currentBest!.price).toBe(29.99);
  });

  it('returns currentBest as null when prices array is empty', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_NO_PRICES);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result).not.toBeNull();
    expect(result!.currentBest).toBeNull();
  });

  it('uses single store as currentBest for single-entry overview', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest).not.toBeNull();
    expect(result!.currentBest!.price).toBe(29.99);
  });
});

// ─── fetchGamePricing — historyLow ───────────────────────────────────────────

describe('fetchGamePricing — historyLow', () => {
  it('maps historical low to contract shape', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow).toMatchObject({
      price: expect.any(Number),
      shop: expect.any(String),
      date: expect.any(String),
    });
  });

  it('maps lowest.price.amount to historyLow.price', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.price).toBe(14.99);
  });

  it('maps lowest.shop.name to historyLow.shop', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.shop).toBe('Steam');
  });

  it('maps lowest.recorded to historyLow.date', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.date).toBe('2024-11-25T00:00:00Z');
  });

  it('returns null historyLow when overview.lowest is null', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_NO_LOW);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow).toBeNull();
  });
});

// ─── fetchGamePricing — currency ─────────────────────────────────────────────

describe('fetchGamePricing — currency', () => {
  it('extracts currency from first price entry', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('USD');
  });

  it('defaults to "USD" when prices array is empty', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_NO_PRICES);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('USD');
  });

  it('uses currency from overview when set to non-USD', async () => {
    const eurOverview: ItadOverviewEntry = {
      prices: [
        {
          ...STEAM_PRICE_ENTRY,
          price: { amount: 27.99, amountInt: 2799, currency: 'EUR' },
          regular: { amount: 55.99, amountInt: 5599, currency: 'EUR' },
        },
      ],
      lowest: null,
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(eurOverview);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('EUR');
  });
});

// ─── fetchGamePricing — dealQuality ──────────────────────────────────────────

describe('fetchGamePricing — dealQuality', () => {
  it('returns null dealQuality when there is no discount', async () => {
    const fullPriceOverview: ItadOverviewEntry = {
      prices: [
        {
          ...STEAM_PRICE_ENTRY,
          price: { amount: 59.99, amountInt: 5999, currency: 'USD' },
          cut: 0,
        },
      ],
      lowest: HISTORY_LOW,
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(fullPriceOverview);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBeNull();
  });

  it('returns "great" when current price is within 10% of historical low', async () => {
    // Historical low: 14.99, current: 15.99 (ratio ≈ 0.067 — within 10%)
    const greatDealOverview: ItadOverviewEntry = {
      prices: [
        {
          ...STEAM_PRICE_ENTRY,
          price: { amount: 15.99, amountInt: 1599, currency: 'USD' },
          cut: 75,
        },
      ],
      lowest: HISTORY_LOW,
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(greatDealOverview);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('great');
  });

  it('returns "good" when current price is within 25% of historical low', async () => {
    // Historical low: 14.99, current: 17.99 (ratio ≈ 0.20 — within 25%)
    const goodDealOverview: ItadOverviewEntry = {
      prices: [
        {
          ...STEAM_PRICE_ENTRY,
          price: { amount: 17.99, amountInt: 1799, currency: 'USD' },
          cut: 70,
        },
      ],
      lowest: HISTORY_LOW,
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(goodDealOverview);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('good');
  });

  it('returns "modest" when current price is more than 25% above historical low', async () => {
    // Historical low: 14.99, current: 29.99 (ratio ≈ 1.0 — well above 25%)
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('modest');
  });

  it('returns "modest" when there is a discount but no historical low data', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_NO_LOW);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('modest');
  });

  it('returns null dealQuality when prices array is empty', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_NO_PRICES);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBeNull();
  });

  it('returns "great" when current price exactly equals historical low', async () => {
    // ratio = 0, which is <= 0.1 threshold
    const atLowOverview: ItadOverviewEntry = {
      prices: [
        {
          ...STEAM_PRICE_ENTRY,
          price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
          cut: 75,
        },
      ],
      lowest: HISTORY_LOW,
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(atLowOverview);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('great');
  });
});

// ─── fetchGamePricing — full output shape ────────────────────────────────────

describe('fetchGamePricing — full output shape', () => {
  it('returns an object conforming to ItadGamePricingDto shape', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(OVERVIEW_SINGLE_STORE);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result).toMatchObject({
      currentBest: expect.objectContaining({
        shop: expect.any(String),
        url: expect.any(String),
        price: expect.any(Number),
        regularPrice: expect.any(Number),
        discount: expect.any(Number),
      }),
      stores: expect.any(Array),
      historyLow: expect.objectContaining({
        price: expect.any(Number),
        shop: expect.any(String),
        date: expect.any(String),
      }),
      dealQuality: expect.stringMatching(/great|good|modest/),
      currency: expect.any(String),
    });
  });
});
