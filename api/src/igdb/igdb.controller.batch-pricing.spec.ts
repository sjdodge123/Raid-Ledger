/**
 * Adversarial unit tests for IgdbController.batchPricing (ROK-800).
 * Tests GET /games/pricing/batch endpoint routing and edge cases.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';
import { ItadPriceService } from '../itad/itad-price.service';
import { ItadService } from '../itad/itad.service';
import { SettingsService } from '../settings/settings.service';
// ─── Shared helpers ──────────────────────────────────────────────────────────

function buildMockDb(
  batchResult: Record<string, unknown>,
): Record<string, jest.Mock> {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.where = jest.fn().mockResolvedValue(
    Object.keys(batchResult).map((k) => ({
      id: Number(k),
      itadGameId: `itad-${k}`,
    })),
  );
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

async function createController(
  mockService: Partial<IgdbService>,
  mockItadService: Partial<ItadPriceService>,
): Promise<IgdbController> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [IgdbController],
    providers: [
      { provide: IgdbService, useValue: mockService },
      { provide: ItadPriceService, useValue: mockItadService },
      { provide: ItadService, useValue: {} },
      { provide: SettingsService, useValue: {} },
    ],
  }).compile();
  return module.get<IgdbController>(IgdbController);
}

// ─── batchPricing — empty / short-circuit paths ──────────────────────────────

describe('IgdbController.batchPricing — empty/null paths (ROK-800)', () => {
  it('returns empty data object when idsParam is undefined', async () => {
    const mockItad = { getOverviewBatch: jest.fn() };
    const db = buildMockDb({});
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing(undefined as unknown as string);

    expect(result).toEqual({ data: {} });
    expect(mockItad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('returns empty data object when idsParam is empty string', async () => {
    const mockItad = { getOverviewBatch: jest.fn() };
    const db = buildMockDb({});
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('');

    expect(result).toEqual({ data: {} });
    expect(mockItad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('returns empty data object when all IDs are invalid', async () => {
    const mockItad = { getOverviewBatch: jest.fn() };
    const db = buildMockDb({});
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('abc,xyz,-1,0');

    expect(result).toEqual({ data: {} });
  });
});

// ─── batchPricing — valid IDs delegates to fetchBatchGamePricing ─────────────

describe('IgdbController.batchPricing — valid IDs (ROK-800)', () => {
  it('returns wrapped data object with pricing keyed by game ID', async () => {
    // Use a db that returns no rows (so all games get null pricing)
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('1,2,3');

    expect(result).toHaveProperty('data');
    expect(typeof result.data).toBe('object');
    // All 3 IDs should appear in result (as null since no ITAD data)
    expect(Object.keys(result.data)).toHaveLength(3);
  });

  it('result data keys are string game IDs', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('5,10');

    expect(Object.keys(result.data)).toEqual(
      expect.arrayContaining(['5', '10']),
    );
  });

  it('returns null for games without ITAD IDs', async () => {
    // DB returns no itad IDs (first query), no cached pricing (second query)
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest
        .fn()
        .mockResolvedValueOnce([{ id: 7, itadGameId: null }])
        .mockResolvedValueOnce([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('7');

    expect(result.data['7']).toBeNull();
  });

  it('returns pricing for games with ITAD IDs and overview data', async () => {
    // First query: ID lookup, second query: no cached pricing
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest
        .fn()
        .mockResolvedValueOnce([{ id: 42, itadGameId: 'itad-42' }])
        .mockResolvedValueOnce([]),
    };
    const overviewEntry = {
      id: 'itad-42',
      current: {
        shop: { id: 61, name: 'Steam' },
        price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
        regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
        cut: 50,
        url: 'https://steam.com/app/42',
      },
      lowest: null,
      bundled: 0,
      urls: { game: 'https://isthereanydeal.com/game/42/' },
    };
    const mockItad = {
      getOverviewBatch: jest.fn().mockResolvedValue([overviewEntry]),
    };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('42');

    expect(result.data['42']).toMatchObject({
      currentBest: expect.objectContaining({ shop: 'Steam' }),
      currency: 'USD',
    });
  });
});

// ─── batchPricing — caps at 100 IDs (via parseBatchIds) ─────────────────────

describe('IgdbController.batchPricing — ID parsing edge cases (ROK-800)', () => {
  it('strips whitespace and parses valid IDs from query string', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing(' 1 , 2 , 3 ');

    expect(Object.keys(result.data)).toHaveLength(3);
  });

  it('filters out negative and zero IDs from query string', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    // Only ID 5 is valid
    const result = await ctrl.batchPricing('-1,0,5');

    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data['5']).toBeNull();
  });

  it('accepts a single valid ID', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const mockItad = { getOverviewBatch: jest.fn().mockResolvedValue([]) };
    const ctrl = await createController(buildMockService(db), mockItad);

    const result = await ctrl.batchPricing('99');

    expect(Object.keys(result.data)).toHaveLength(1);
    expect(Object.keys(result.data)[0]).toBe('99');
  });
});

// ─── Individual pricing endpoint still works (AC: unchanged behavior) ─────────

describe('IgdbController.getGamePricing — individual pricing unchanged (ROK-800)', () => {
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
    const mockItad = {
      getOverview: jest.fn().mockResolvedValue(overviewEntry),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IgdbController],
      providers: [
        {
          provide: IgdbService,
          useValue: buildMockService(db),
        },
        { provide: ItadPriceService, useValue: mockItad },
        { provide: ItadService, useValue: {} },
        { provide: SettingsService, useValue: {} },
      ],
    }).compile();

    const ctrl = module.get<IgdbController>(IgdbController);
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
    const mockItad = { getOverview: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IgdbController],
      providers: [
        { provide: IgdbService, useValue: buildMockService(db) },
        { provide: ItadPriceService, useValue: mockItad },
        { provide: ItadService, useValue: {} },
        { provide: SettingsService, useValue: {} },
      ],
    }).compile();

    const ctrl = module.get<IgdbController>(IgdbController);
    const result = await ctrl.getGamePricing(404);

    expect(result.data).toBeNull();
    expect(mockItad.getOverview).not.toHaveBeenCalled();
  });

  it('individual pricing does not use getOverviewBatch', async () => {
    const db: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ itadGameId: 'itad-x' }]),
    };
    const mockItad = {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IgdbController],
      providers: [
        { provide: IgdbService, useValue: buildMockService(db) },
        { provide: ItadPriceService, useValue: mockItad },
        { provide: ItadService, useValue: {} },
        { provide: SettingsService, useValue: {} },
      ],
    }).compile();

    const ctrl = module.get<IgdbController>(IgdbController);
    await ctrl.getGamePricing(1);

    expect(mockItad.getOverview).toHaveBeenCalled();
    expect(mockItad.getOverviewBatch).not.toHaveBeenCalled();
  });
});
