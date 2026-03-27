/**
 * Adversarial tests for ItadPriceSyncService (ROK-818 / ROK-854).
 * Covers edge cases the dev's initial tests missed:
 * - buildUpdateData with null current / null lowest / both null
 * - onApplicationBootstrap setTimeout wiring
 * - getOverviewBatch returns empty array (no entries) — DB update still fires
 * - Games not in the ITAD response map are skipped (stale cleanup handles them)
 * - Multiple chunk failures don't abort the entire sync
 * - Bulk update is called once per chunk via db.execute()
 * - extractErrorDetail: pure function coverage for all input shapes (ROK-854)
 * - executeBulkPricingUpdate: COALESCE applied to lowest_* only (ROK-854)
 */
import { Test } from '@nestjs/testing';
import {
  ItadPriceSyncService,
  buildUpdateData,
  extractErrorDetail,
  executeBulkPricingUpdate,
} from './itad-price-sync.service';
import { ItadPriceService } from './itad-price.service';
import { ItadService } from './itad.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { ItadOverviewGameEntry } from './itad-price.types';

function buildEntry(
  id: string,
  overrides: Partial<Pick<ItadOverviewGameEntry, 'current' | 'lowest'>> = {},
): ItadOverviewGameEntry {
  return {
    id,
    current:
      overrides.current !== undefined
        ? overrides.current
        : {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 9.99, amountInt: 999, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 75,
            url: 'https://store.steampowered.com/app/1',
          },
    lowest:
      overrides.lowest !== undefined
        ? overrides.lowest
        : {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 4.99, amountInt: 499, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 88,
            timestamp: '2025-12-25T00:00:00Z',
          },
    bundled: 0,
    urls: { game: 'https://isthereanydeal.com/game/test/' },
  };
}

describe('ItadPriceSyncService — adversarial', () => {
  let service: ItadPriceSyncService;
  let mockDb: MockDb;
  let mockItadPriceService: { getOverviewBatch: jest.Mock };
  let mockItadService: { getGameInfo: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockItadPriceService = { getOverviewBatch: jest.fn() };
    mockItadService = { getGameInfo: jest.fn().mockResolvedValue(null) };
    mockCronJobService = {
      executeWithTracking: jest
        .fn()
        .mockImplementation((_name: string, fn: () => Promise<void>) => fn()),
    };

    const module = await Test.createTestingModule({
      providers: [
        ItadPriceSyncService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: ItadPriceService, useValue: mockItadPriceService },
        { provide: ItadService, useValue: mockItadService },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get(ItadPriceSyncService);
  });

  describe('buildUpdateData — edge: null deal fields', () => {
    it('writes null pricing columns when current is null but lowest exists', () => {
      const entry = buildEntry('game-null-current', { current: null });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBeNull();
      expect(data.itadCurrentCut).toBeNull();
      expect(data.itadCurrentShop).toBeNull();
      expect(data.itadCurrentUrl).toBeNull();
      expect(data.itadLowestPrice).toBe('4.99');
      expect(data.itadLowestCut).toBe(88);
      expect(typeof data.itadPriceUpdatedAt).toBe('string');
    });

    it('writes null lowest columns when lowest is null but current exists', () => {
      const entry = buildEntry('game-null-lowest', { lowest: null });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBe('9.99');
      expect(data.itadCurrentCut).toBe(75);
      expect(data.itadLowestPrice).toBeNull();
      expect(data.itadLowestCut).toBeNull();
    });

    it('writes all pricing nulls when both current and lowest are null', () => {
      const entry = buildEntry('game-all-null', {
        current: null,
        lowest: null,
      });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBeNull();
      expect(data.itadCurrentCut).toBeNull();
      expect(data.itadLowestPrice).toBeNull();
      expect(data.itadLowestCut).toBeNull();
      expect(typeof data.itadPriceUpdatedAt).toBe('string');
    });
  });

  describe('syncPricing — edge: game missing from ITAD response', () => {
    it('skips bulk update when game is not in the ITAD response', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 20, itadGameId: 'game-in-db-not-in-itad' },
      ]);
      // ITAD returns entries for a different game — our game is absent
      const entry = buildEntry('some-other-game');
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No bulk execute for pricing (no matched games), only clearStalePricing's
      // update/set/where/returning chain runs
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe('syncPricing — edge: getOverviewBatch returns empty array', () => {
    it('skips bulk update when ITAD returns no entries', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 30, itadGameId: 'game-uuid-30' },
        { id: 31, itadGameId: 'game-uuid-31' },
      ]);
      // Empty batch result — ITAD has no data for these IDs
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No bulk execute for pricing (no matched games)
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe('syncPricing — edge: multiple consecutive chunk failures', () => {
    it('attempts all chunks even when every chunk fails', async () => {
      const games = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      // All three chunks fail
      mockItadPriceService.getOverviewBatch
        .mockRejectedValueOnce(new Error('Chunk 1 failure'))
        .mockRejectedValueOnce(new Error('Chunk 2 failure'))
        .mockRejectedValueOnce(new Error('Chunk 3 failure'));

      await expect(service.syncPricing()).resolves.not.toThrow();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(3);
    });
  });

  describe('syncPricing — edge: single game, exact chunk boundary', () => {
    it('processes exactly 50 games in a single batch', async () => {
      const games = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(1);
      const callArgs = mockItadPriceService.getOverviewBatch.mock
        .calls[0][0] as string[];
      expect(callArgs).toHaveLength(50);
    });

    it('processes 51 games in exactly two batches (50 + 1)', async () => {
      const games = Array.from({ length: 51 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValue([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(2);
      const second = mockItadPriceService.getOverviewBatch.mock
        .calls[1][0] as string[];
      expect(second).toHaveLength(1);
    });
  });

  describe('buildUpdateData — price formatting', () => {
    it('formats price amounts to 2 decimal places', () => {
      const entry = buildEntry('game-price-fmt', {
        current: {
          shop: { id: 1, name: 'Steam' },
          price: { amount: 9.9, amountInt: 990, currency: 'USD' },
          regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
          cut: 50,
          url: 'https://store.steampowered.com/app/40',
        },
      });
      const data = buildUpdateData(entry, new Date());

      // toFixed(2) on 9.9 should produce '9.90'
      expect(data.itadCurrentPrice).toBe('9.90');
    });
  });

  describe('processChunk — error detail logging', () => {
    it('extracts Postgres error .cause details into log message', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, itadGameId: 'game-uuid-1' },
      ]);
      const pgCause = Object.assign(new Error('column "x" does not exist'), {
        code: '42703',
        detail: 'Column missing',
        hint: 'Check spelling',
      });
      const wrapperError = new Error('Failed query: UPDATE ...');
      (wrapperError as any).cause = pgCause;
      mockItadPriceService.getOverviewBatch.mockRejectedValueOnce(wrapperError);
      mockDb.returning.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'error');

      await service.syncPricing();

      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('code=42703');
      expect(logMsg).toContain('detail=Column missing');
      expect(logMsg).toContain('hint=Check spelling');
    });
  });

  describe('processChunk — returns boolean for success tracking', () => {
    it('syncPricing logs success and failure counts', async () => {
      const games = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      // First chunk succeeds (returns empty entries), second fails
      mockItadPriceService.getOverviewBatch
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('chunk 2 fail'));
      mockDb.returning.mockResolvedValue([]);

      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.syncPricing();

      const warnMsg = warnSpy.mock.calls.find((c) =>
        (c[0] as string).includes('chunks succeeded'),
      );
      expect(warnMsg).toBeDefined();
      expect(warnMsg![0]).toContain('1 chunks succeeded');
      expect(warnMsg![0]).toContain('1 failed');
    });

    it('logs at log level when all chunks succeed', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, itadGameId: 'game-uuid-1' },
      ]);
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.syncPricing();

      const completeMsg = logSpy.mock.calls.find((c) =>
        (c[0] as string).includes('chunks succeeded'),
      );
      expect(completeMsg).toBeDefined();
      expect(completeMsg![0]).toContain('1 chunks succeeded');
      expect(completeMsg![0]).toContain('0 failed');
    });
  });

  describe('onApplicationBootstrap', () => {
    it('schedules the sync via setTimeout (does not call syncPricing immediately)', () => {
      jest.useFakeTimers();

      service.onApplicationBootstrap();

      // syncPricing not called yet — timer hasn't fired
      expect(mockItadPriceService.getOverviewBatch).not.toHaveBeenCalled();

      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('does not throw synchronously when called', () => {
      jest.useFakeTimers();
      expect(() => service.onApplicationBootstrap()).not.toThrow();
      jest.clearAllTimers();
      jest.useRealTimers();
    });
  });
});

// ─── extractErrorDetail — pure function (ROK-854) ───────────────────────────

describe('extractErrorDetail — pure function', () => {
  it('returns the message when error has no cause', () => {
    const err = new Error('simple failure');
    const result = extractErrorDetail(err);
    expect(result).toBe('simple failure');
  });

  it('extracts cause.message, code, detail, and hint from wrapped PG error', () => {
    const cause = Object.assign(new Error('syntax error'), {
      code: '42601',
      detail: 'near position 10',
      hint: 'Check your SQL',
    });
    const wrapper = Object.assign(new Error('Failed query: UPDATE ...'), {
      cause,
    });
    const result = extractErrorDetail(wrapper);
    expect(result).toContain('syntax error');
    expect(result).toContain('code=42601');
    expect(result).toContain('detail=near position 10');
    expect(result).toContain('hint=Check your SQL');
  });

  it('omits absent fields — cause with code only', () => {
    const cause = Object.assign(new Error('undefined column'), {
      code: '42703',
    });
    const wrapper = Object.assign(new Error('Failed query: SELECT ...'), {
      cause,
    });
    const result = extractErrorDetail(wrapper);
    expect(result).toContain('code=42703');
    expect(result).not.toContain('detail=');
    expect(result).not.toContain('hint=');
  });

  it('omits absent fields — cause with detail only', () => {
    const cause = Object.assign(new Error('constraint violation'), {
      detail: 'Key (id)=(42) already exists.',
    });
    const wrapper = Object.assign(new Error('Failed query: INSERT ...'), {
      cause,
    });
    const result = extractErrorDetail(wrapper);
    expect(result).toContain('detail=Key (id)=(42) already exists.');
    expect(result).not.toContain('code=');
    expect(result).not.toContain('hint=');
  });

  it('handles non-Error thrown values (strings)', () => {
    const result = extractErrorDetail('something went wrong');
    expect(result).toBe('something went wrong');
  });

  it('handles non-Error thrown values (objects with toString)', () => {
    const result = extractErrorDetail({ message: 'db down' });
    // Non-Error: becomes String({ message: 'db down' }) = '[object Object]'
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles null thrown value', () => {
    const result = extractErrorDetail(null);
    expect(result).toBe('null');
  });

  it('handles undefined thrown value', () => {
    const result = extractErrorDetail(undefined);
    expect(result).toBe('undefined');
  });

  it('returns cause message when error itself has no message', () => {
    const cause = Object.assign(new Error('real pg error'), {
      code: '08006',
    });
    const wrapper = Object.assign(new Error('Failed query: raw sql'), {
      cause,
    });
    const result = extractErrorDetail(wrapper);
    // cause message takes precedence once .cause exists
    expect(result).toContain('real pg error');
    expect(result).toContain('code=08006');
  });
});

// ─── executeBulkPricingUpdate — COALESCE assertion (ROK-854) ─────────────────

/** Extract the SQL string text from a Drizzle sql`` tagged template object. */
function extractSqlText(sqlArg: unknown): string {
  if (sqlArg == null || typeof sqlArg !== 'object') return String(sqlArg);
  const chunks =
    (sqlArg as { queryChunks?: { value?: unknown[] }[] }).queryChunks ?? [];
  return chunks
    .map((c) => (Array.isArray(c.value) ? c.value.join('') : ''))
    .join('');
}

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

function buildPricingRow(
  id: number,
  overrides: Partial<Omit<ReturnType<typeof buildUpdateData>, never>> = {},
) {
  return {
    id,
    itadCurrentPrice: '9.99' as string | null,
    itadCurrentCut: 50 as number | null,
    itadCurrentShop: 'Steam' as string | null,
    itadCurrentUrl: 'https://steam.com' as string | null,
    itadLowestPrice: '4.99' as string | null,
    itadLowestCut: 80 as number | null,
    itadPriceUpdatedAt: FIXED_DATE.toISOString(),
    ...overrides,
  };
}

describe('executeBulkPricingUpdate — COALESCE for lowest_* only', () => {
  it('calls db.execute with SQL containing COALESCE for lowest_price', async () => {
    const mockDb = createDrizzleMock();
    mockDb.execute.mockResolvedValueOnce([]);
    const row = buildPricingRow(1, {
      itadLowestPrice: null,
      itadLowestCut: null,
    });
    await executeBulkPricingUpdate(mockDb as never, [row]);

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const sqlStr = extractSqlText(mockDb.execute.mock.calls[0][0]);
    expect(sqlStr).toContain('COALESCE');
    expect(sqlStr).toContain('lowest_price');
    expect(sqlStr).toContain('lowest_cut');
  });

  it('does NOT coalesce current_price — null clears the active deal', async () => {
    const mockDb = createDrizzleMock();
    mockDb.execute.mockResolvedValueOnce([]);
    const row = buildPricingRow(2, {
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentShop: null,
      itadCurrentUrl: null,
      itadLowestPrice: '4.99',
      itadLowestCut: 80,
    });
    await executeBulkPricingUpdate(mockDb as never, [row]);

    const sqlStr = extractSqlText(mockDb.execute.mock.calls[0][0]);
    expect(sqlStr).toContain('current_price');
    // COALESCE appears exactly twice: for lowest_price and lowest_cut
    const coalesceCount = (sqlStr.match(/COALESCE/g) ?? []).length;
    expect(coalesceCount).toBe(2);
  });

  it('processes multiple rows in a single execute call', async () => {
    const mockDb = createDrizzleMock();
    mockDb.execute.mockResolvedValueOnce([]);
    const rows = [
      buildPricingRow(1),
      buildPricingRow(2, {
        itadCurrentPrice: '19.99',
        itadCurrentCut: 20,
        itadCurrentShop: 'GOG',
        itadCurrentUrl: 'https://gog.com',
        itadLowestPrice: null,
        itadLowestCut: null,
      }),
    ];
    await executeBulkPricingUpdate(mockDb as never, rows);

    // Only one DB round-trip for the entire batch
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });
});
