/**
 * Unit tests for igdb-pricing.helpers (ROK-419).
 * Covers fetchGamePricing, mapping logic, deal quality computation,
 * and all graceful-degradation paths.
 */
import { fetchGamePricing } from './igdb-pricing.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

// ─── DB mock helpers ─────────────────────────────────────────────────────────

/** Build a DB mock that returns a specific itadGameId from the games table. */
function buildDbWithItadId(
  itadGameId: string | null,
): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest
    .fn()
    .mockResolvedValue(itadGameId !== null ? [{ itadGameId }] : []);
  return db;
}

/** Build a minimal ItadPriceService mock. */
function buildPriceService(
  overview: ItadOverviewGameEntry | null,
): Pick<ItadPriceService, 'getOverview'> {
  return { getOverview: jest.fn().mockResolvedValue(overview) };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_ENTRY: ItadOverviewGameEntry = {
  id: 'uuid-game-1',
  current: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 50,
    url: 'https://store.steampowered.com/app/12345',
  },
  lowest: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 75,
    timestamp: '2024-11-25T00:00:00Z',
  },
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/test/' },
};

// ─── fetchGamePricing — null paths ───────────────────────────────────────────

describe('fetchGamePricing — null paths', () => {
  it('returns null when game has no ITAD ID in DB', async () => {
    const db = buildDbWithItadId(null);
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 99);

    expect(result).toBeNull();
    expect(svc.getOverview).not.toHaveBeenCalled();
  });

  it('returns null when DB returns empty rows for gameId', async () => {
    const db = buildDbWithItadId(null);
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 999);

    expect(result).toBeNull();
  });

  it('returns null when ItadPriceService returns null', async () => {
    const db = buildDbWithItadId('uuid-game-abc');
    const svc = buildPriceService(null);

    const result = await fetchGamePricing(db as never, svc as never, 42);

    expect(result).toBeNull();
  });

  it('passes correct itadGameId from DB to price service', async () => {
    const db = buildDbWithItadId('uuid-elden-ring');
    const svc = buildPriceService(BASE_ENTRY);

    await fetchGamePricing(db as never, svc as never, 7);

    expect(svc.getOverview).toHaveBeenCalledWith('uuid-elden-ring');
  });
});

// ─── fetchGamePricing — currentBest mapping ──────────────────────────────────

describe('fetchGamePricing — currentBest mapping', () => {
  it('maps current deal to currentBest with correct fields', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest).toMatchObject({
      shop: 'Steam',
      url: 'https://store.steampowered.com/app/12345',
      price: 29.99,
      regularPrice: 59.99,
      discount: 50,
    });
  });

  it('returns null currentBest when entry.current is null', async () => {
    const noCurrentEntry = {
      ...BASE_ENTRY,
      current: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noCurrentEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest).toBeNull();
  });

  it('maps shop name (not ID) to currentBest.shop', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest!.shop).toBe('Steam');
  });

  it('maps price.amount to currentBest.price', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest!.price).toBe(29.99);
  });

  it('maps regular.amount to currentBest.regularPrice', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest!.regularPrice).toBe(59.99);
  });

  it('maps cut to currentBest.discount', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currentBest!.discount).toBe(50);
  });
});

// ─── fetchGamePricing — stores ───────────────────────────────────────────────

describe('fetchGamePricing — stores', () => {
  it('wraps currentBest in stores array when current deal exists', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores).toHaveLength(1);
    expect(result!.stores[0]).toEqual(result!.currentBest);
  });

  it('returns empty stores array when no current deal', async () => {
    const noCurrentEntry = {
      ...BASE_ENTRY,
      current: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noCurrentEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.stores).toHaveLength(0);
  });
});

// ─── fetchGamePricing — historyLow ───────────────────────────────────────────

describe('fetchGamePricing — historyLow', () => {
  it('maps historical low to contract shape', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow).toMatchObject({
      price: 14.99,
      shop: 'Steam',
      date: '2024-11-25T00:00:00Z',
    });
  });

  it('maps lowest.price.amount to historyLow.price', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.price).toBe(14.99);
  });

  it('maps lowest.shop.name to historyLow.shop', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.shop).toBe('Steam');
  });

  it('maps lowest.timestamp to historyLow.date', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow!.date).toBe('2024-11-25T00:00:00Z');
  });

  it('returns null historyLow when entry.lowest is null', async () => {
    const noLowest = {
      ...BASE_ENTRY,
      lowest: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noLowest);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.historyLow).toBeNull();
  });
});

// ─── fetchGamePricing — currency ─────────────────────────────────────────────

describe('fetchGamePricing — currency', () => {
  it('extracts currency from current deal', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('USD');
  });

  it('defaults to USD when current is null', async () => {
    const noCurrentEntry = {
      ...BASE_ENTRY,
      current: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noCurrentEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('USD');
  });

  it('uses currency from current deal when non-USD', async () => {
    const eurEntry: ItadOverviewGameEntry = {
      ...BASE_ENTRY,
      current: {
        ...BASE_ENTRY.current,
        price: { amount: 27.99, amountInt: 2799, currency: 'EUR' },
        regular: { amount: 55.99, amountInt: 5599, currency: 'EUR' },
      },
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(eurEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.currency).toBe('EUR');
  });
});

// ─── fetchGamePricing — dealQuality ──────────────────────────────────────────

describe('fetchGamePricing — dealQuality', () => {
  it('returns null when there is no discount', async () => {
    const fullPriceEntry: ItadOverviewGameEntry = {
      ...BASE_ENTRY,
      current: {
        ...BASE_ENTRY.current,
        price: { amount: 59.99, amountInt: 5999, currency: 'USD' },
        cut: 0,
      },
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(fullPriceEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBeNull();
  });

  it('returns "great" when current price within 10% of historical low', async () => {
    // Historical low: 14.99, current: 15.99 (ratio ≈ 0.067 — within 10%)
    const greatEntry: ItadOverviewGameEntry = {
      ...BASE_ENTRY,
      current: {
        ...BASE_ENTRY.current,
        price: { amount: 15.99, amountInt: 1599, currency: 'USD' },
        cut: 75,
      },
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(greatEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('great');
  });

  it('returns "good" when current price within 25% of historical low', async () => {
    // Historical low: 14.99, current: 17.99 (ratio ≈ 0.20 — within 25%)
    const goodEntry: ItadOverviewGameEntry = {
      ...BASE_ENTRY,
      current: {
        ...BASE_ENTRY.current,
        price: { amount: 17.99, amountInt: 1799, currency: 'USD' },
        cut: 70,
      },
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(goodEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('good');
  });

  it('returns "modest" when price is more than 25% above historical low', async () => {
    // Historical low: 14.99, current: 29.99 (ratio ≈ 1.0 — well above 25%)
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('modest');
  });

  it('returns "modest" when discount exists but no historical low', async () => {
    const noLowest = {
      ...BASE_ENTRY,
      lowest: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noLowest);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('modest');
  });

  it('returns null when current is null (no deal)', async () => {
    const noCurrent = {
      ...BASE_ENTRY,
      current: null,
    } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noCurrent);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBeNull();
  });

  it('returns "great" when price exactly equals historical low', async () => {
    // ratio = 0, which is <= 0.1 threshold
    const atLowEntry: ItadOverviewGameEntry = {
      ...BASE_ENTRY,
      current: {
        ...BASE_ENTRY.current,
        price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
        cut: 75,
      },
    };
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(atLowEntry);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.dealQuality).toBe('great');
  });
});

// ─── fetchGamePricing — itadUrl ──────────────────────────────────────────────

describe('fetchGamePricing — itadUrl', () => {
  it('includes ITAD game page URL from entry.urls.game', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.itadUrl).toBe('https://isthereanydeal.com/game/test/');
  });

  it('returns null itadUrl when urls is missing', async () => {
    const noUrls = { ...BASE_ENTRY, urls: undefined } as unknown as ItadOverviewGameEntry;
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(noUrls);

    const result = await fetchGamePricing(db as never, svc as never, 1);

    expect(result!.itadUrl).toBeNull();
  });
});

// ─── fetchGamePricing — full output shape ────────────────────────────────────

describe('fetchGamePricing — full output shape', () => {
  it('returns object conforming to ItadGamePricingDto', async () => {
    const db = buildDbWithItadId('uuid-game-1');
    const svc = buildPriceService(BASE_ENTRY);

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
      itadUrl: expect.any(String),
    });
  });
});
