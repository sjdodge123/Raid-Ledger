/**
 * Adversarial unit tests for IgdbController.batchPricing.
 * ROK-800: original wrapping/parsing semantics.
 * ROK-1047: cached-immediate + async-fetch behavior — no synchronous
 *   ITAD calls; uncached IDs come back null and are enqueued for
 *   out-of-band fetch.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';
import { ItadPriceService } from '../itad/itad-price.service';
import { ItadService } from '../itad/itad.service';
import { SettingsService } from '../settings/settings.service';
import { ITAD_PRICE_SYNC_QUEUE } from '../itad/itad-price-sync.constants';

// ─── Shared helpers ──────────────────────────────────────────────────────────

interface DbBuilder {
  idRows?: { id: number; itadGameId: string | null }[];
  cacheRows?: unknown[];
}

/**
 * DB mock that returns the configured ID rows on the first .where() call
 * (the itad-id lookup) and the configured cache rows on the second call
 * (cached pricing lookup). Helpers return [] / [] by default.
 */
function buildDb({ idRows = [], cacheRows = [] }: DbBuilder = {}): Record<
  string,
  jest.Mock
> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest
    .fn()
    .mockResolvedValueOnce(idRows)
    .mockResolvedValueOnce(cacheRows);
  return db;
}

function buildMockService(db: Record<string, jest.Mock>): Partial<IgdbService> {
  return {
    searchGames: jest.fn(),
    database: db as never,
    redisClient: {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn(),
    } as never,
    config: {} as never,
    getGameDetailById: jest.fn() as never,
    enqueueSync: jest.fn() as never,
  };
}

function buildMockQueue(): { add: jest.Mock } {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

async function createController(
  mockService: Partial<IgdbService>,
  mockItadService: Partial<ItadPriceService>,
  mockQueue: { add: jest.Mock } = buildMockQueue(),
): Promise<{ ctrl: IgdbController; queue: { add: jest.Mock } }> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [IgdbController],
    providers: [
      { provide: IgdbService, useValue: mockService },
      { provide: ItadPriceService, useValue: mockItadService },
      { provide: ItadService, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: getQueueToken(ITAD_PRICE_SYNC_QUEUE), useValue: mockQueue },
    ],
  }).compile();
  return { ctrl: module.get<IgdbController>(IgdbController), queue: mockQueue };
}

// ─── batchPricing — empty / short-circuit paths ──────────────────────────────

describe('IgdbController.batchPricing — empty/null paths', () => {
  it('returns empty data object when idsParam is undefined', async () => {
    const { ctrl, queue } = await createController(
      buildMockService(buildDb()),
      { getOverviewBatch: jest.fn() },
    );

    const result = await ctrl.batchPricing(undefined as unknown as string);

    expect(result).toEqual({ data: {} });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns empty data object when idsParam is empty string', async () => {
    const { ctrl, queue } = await createController(
      buildMockService(buildDb()),
      { getOverviewBatch: jest.fn() },
    );

    const result = await ctrl.batchPricing('');

    expect(result).toEqual({ data: {} });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('returns empty data object when all IDs are invalid', async () => {
    const { ctrl } = await createController(buildMockService(buildDb()), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('abc,xyz,-1,0');

    expect(result).toEqual({ data: {} });
  });
});

// ─── batchPricing — ROK-1047 async-fetch behavior ───────────────────────────

describe('IgdbController.batchPricing — ROK-1047 async fetch', () => {
  it('returns null for uncached games and enqueues a sync per id', async () => {
    const db = buildDb({
      idRows: [
        { id: 1, itadGameId: 'itad-1' },
        { id: 2, itadGameId: 'itad-2' },
      ],
      cacheRows: [],
    });
    const { ctrl, queue } = await createController(buildMockService(db), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('1,2');

    expect(result.data['1']).toBeNull();
    expect(result.data['2']).toBeNull();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'sync',
      { gameId: 1 },
      expect.objectContaining({ jobId: 'itad-price-1' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'sync',
      { gameId: 2 },
      expect.objectContaining({ jobId: 'itad-price-2' }),
    );
  });

  it('does not call ITAD getOverviewBatch on the request path', async () => {
    const db = buildDb({
      idRows: [{ id: 1, itadGameId: 'itad-1' }],
      cacheRows: [],
    });
    const itad = { getOverviewBatch: jest.fn() };
    const { ctrl } = await createController(buildMockService(db), itad);

    await ctrl.batchPricing('1');

    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('does not enqueue when game has no ITAD ID — nothing to fetch', async () => {
    const db = buildDb({
      idRows: [{ id: 7, itadGameId: null }],
      cacheRows: [],
    });
    const { ctrl, queue } = await createController(buildMockService(db), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('7');

    expect(result.data['7']).toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('responds in <50ms even when ITAD service throws (no sync call)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const db = buildDb({
      idRows: ids.map((id) => ({ id, itadGameId: `itad-${id}` })),
      cacheRows: [],
    });
    const itad = {
      getOverviewBatch: jest.fn(() => {
        throw new Error('ITAD unavailable');
      }),
    };
    const { ctrl } = await createController(buildMockService(db), itad);

    const t0 = Date.now();
    const result = await ctrl.batchPricing(ids.join(','));
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(50);
    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
    for (const id of ids) {
      expect(result.data[String(id)]).toBeNull();
    }
  });

  it('returns cached pricing immediately without enqueueing', async () => {
    const fresh = new Date(); // freshly cached
    const db = buildDb({
      idRows: [{ id: 1, itadGameId: 'itad-1' }],
      cacheRows: [
        {
          id: 1,
          itadCurrentPrice: '9.99',
          itadCurrentCut: 50,
          itadCurrentShop: 'Steam',
          itadCurrentUrl: 'https://steam.com/app/1',
          itadLowestPrice: '4.99',
          itadLowestCut: 75,
          itadPriceUpdatedAt: fresh,
        },
      ],
    });
    const { ctrl, queue } = await createController(buildMockService(db), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('1');

    expect(result.data['1']).toMatchObject({
      currentBest: expect.objectContaining({ shop: 'Steam', price: 9.99 }),
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

// ─── batchPricing — ID parsing edge cases (ROK-800) ─────────────────────────

describe('IgdbController.batchPricing — ID parsing edge cases', () => {
  it('strips whitespace and parses valid IDs from query string', async () => {
    const { ctrl } = await createController(buildMockService(buildDb()), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing(' 1 , 2 , 3 ');

    expect(Object.keys(result.data)).toHaveLength(3);
  });

  it('filters out negative and zero IDs from query string', async () => {
    const { ctrl } = await createController(buildMockService(buildDb()), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('-1,0,5');

    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data['5']).toBeNull();
  });

  it('accepts a single valid ID', async () => {
    const { ctrl } = await createController(buildMockService(buildDb()), {
      getOverviewBatch: jest.fn(),
    });

    const result = await ctrl.batchPricing('99');

    expect(Object.keys(result.data)).toHaveLength(1);
    expect(Object.keys(result.data)[0]).toBe('99');
  });
});

// ─── Individual pricing endpoint still works (AC: unchanged behavior) ─────────

describe('IgdbController.getGamePricing — individual pricing unchanged', () => {
  it('returns wrapped data from fetchGamePricing', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ itadGameId: 'itad-99' }]),
    };
    const overviewEntry = {
      id: 'itad-99',
      current: {
        shop: { id: 61, name: 'Steam' },
        price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
        regular: { amount: 29.99, amountInt: 2999, currency: 'USD' },
        cut: 50,
        url: 'https://steam.com/app/99',
      },
      lowest: null,
      bundled: 0,
      urls: { game: 'https://isthereanydeal.com/game/99/' },
    };
    const itad = {
      getOverview: jest.fn().mockResolvedValue(overviewEntry),
    };
    const { ctrl } = await createController(buildMockService(db), itad);

    const result = await ctrl.getGamePricing(99);

    expect(result).toHaveProperty('data');
    expect(result.data).toMatchObject({
      currentBest: expect.objectContaining({ shop: 'Steam' }),
      currency: 'USD',
    });
  });

  it('returns null data when game has no ITAD ID (individual endpoint)', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    const itad = { getOverview: jest.fn() };
    const { ctrl } = await createController(buildMockService(db), itad);

    const result = await ctrl.getGamePricing(404);

    expect(result.data).toBeNull();
    expect(itad.getOverview).not.toHaveBeenCalled();
  });

  it('individual pricing does not use getOverviewBatch', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ itadGameId: 'itad-x' }]),
    };
    const itad = {
      getOverview: jest.fn().mockResolvedValue({
        id: 'itad-x',
        current: {
          shop: { id: 61, name: 'Steam' },
          price: { amount: 9.99, amountInt: 999, currency: 'USD' },
          regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
          cut: 50,
          url: 'https://steam.com/app/x',
        },
        lowest: null,
        bundled: 0,
        urls: { game: 'https://isthereanydeal.com/game/x/' },
      }),
      getOverviewBatch: jest.fn(),
    };
    const { ctrl } = await createController(buildMockService(db), itad);

    await ctrl.getGamePricing(1);

    expect(itad.getOverview).toHaveBeenCalled();
    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
  });
});
