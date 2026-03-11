/**
 * ROK-698: Unit tests for cache refresh behavior after TTL expiry.
 * Verifies that expired TTL triggers a reload that is always awaited
 * so callers never read stale/empty data during the reload window.
 * (Updated by ROK-781 — ensureCache now always awaits the reload.)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from './settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema';
import { encrypt } from './encryption.util';

/** Build a DB row as returned by drizzle select().from(appSettings). */
function makeRow(key: string, value: string) {
  return {
    key,
    encryptedValue: encrypt(value),
    updatedAt: new Date(),
    createdAt: new Date(),
    id: 1,
  };
}

function describeSettingsServiceROK698BackgroundRefresh() {
  let service: SettingsService;
  let mockDb: {
    select: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
    _selectChain: { from: jest.Mock };
    _insertChain: { values: jest.Mock };
    _deleteChain: { where: jest.Mock };
    _insertValuesChain: { onConflictDoUpdate: jest.Mock };
  };
  let mockEventEmitter: Partial<EventEmitter2>;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-rok698-settings-tests';

    mockDb = {
      _selectChain: { from: jest.fn() },
      _insertChain: { values: jest.fn() },
      _deleteChain: { where: jest.fn() },
      _insertValuesChain: {
        onConflictDoUpdate: jest.fn().mockResolvedValue([]),
      },
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    };

    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._selectChain.from.mockResolvedValue([]);
    mockDb.insert.mockReturnValue(mockDb._insertChain);
    mockDb._insertChain.values.mockReturnValue(mockDb._insertValuesChain);
    mockDb.delete.mockReturnValue(mockDb._deleteChain);
    mockDb._deleteChain.where.mockResolvedValue([]);

    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ============================================================
  // Cache refresh: awaited reload after TTL expiry (ROK-781 fix)
  // ============================================================
  describe('awaited refresh after TTL expiry', () => {
    it('awaits reload and returns fresh data when TTL has expired', async () => {
      jest.useFakeTimers();

      // Initial cache load with a known value
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'initial-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // DB returns updated data on reload
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'refreshed-value'),
      ]);

      // get() should await the reload and return fresh data
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('refreshed-value');
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('returns fresh data immediately after awaited reload', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'old-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Reload returns new value
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'new-value'),
      ]);

      // First get() after expiry awaits reload and returns fresh data
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('new-value');

      // Subsequent get() is served from fresh cache — no extra DB call
      const result2 = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result2).toBe('new-value');
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('does not trigger multiple reloads for concurrent reads', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'cached'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Reload returns fresh data
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'refreshed'),
      ]);

      // Multiple concurrent get() calls after TTL expiry
      const results = await Promise.all([
        service.get(SETTING_KEYS.DEMO_MODE),
        service.get(SETTING_KEYS.DEMO_MODE),
        service.get(SETTING_KEYS.DEMO_MODE),
      ]);

      // All should return fresh value (reload was awaited)
      expect(results).toEqual(['refreshed', 'refreshed', 'refreshed']);

      // Only one DB reload triggered despite 3 concurrent calls
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // Cold cache: first load still blocks (required for startup)
  // ============================================================
  describe('cold cache blocking behavior', () => {
    it('blocks on the initial cache load when cache has never been populated', async () => {
      let resolveLoad!: (value: unknown[]) => void;
      mockDb._selectChain.from.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );

      // Start the get() - it should be pending (blocking)
      let resolved = false;
      const promise = service.get(SETTING_KEYS.DEMO_MODE).then((val) => {
        resolved = true;
        return val;
      });

      // Yield microtask to let async code run
      await new Promise((r) => setImmediate(r));

      // Should NOT have resolved yet since DB hasn't responded
      expect(resolved).toBe(false);

      // Now resolve the DB query
      resolveLoad([makeRow(SETTING_KEYS.DEMO_MODE, 'loaded')]);

      const result = await promise;
      expect(result).toBe('loaded');
      expect(resolved).toBe(true);
    });
  });

  // ============================================================
  // Write-through still resets TTL (no unnecessary background refresh)
  // ============================================================
  describe('write-through TTL reset', () => {
    it('set() resets TTL so background refresh is not triggered prematurely', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'original'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Advance almost to TTL expiry
      jest.advanceTimersByTime(29 * 60_000);

      // Write-through resets the TTL
      await service.set(SETTING_KEYS.DEMO_MODE, 'updated');

      // Advance past where old TTL would have expired
      jest.advanceTimersByTime(2 * 60_000);

      // Should NOT trigger a background refresh since set() reset the TTL
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Background refresh error resilience
  // ============================================================
  describe('refresh error handling', () => {
    it('continues serving stale cache when reload fails', async () => {
      jest.useFakeTimers();

      // Initial load succeeds
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'stable-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Reload fails (loadCache catches internally, does not rethrow)
      mockDb._selectChain.from.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Should still return the stale cached value
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('stable-value');
    });

    it('retries reload on next access after a failure', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'original'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // TTL expiry - reload fails
      jest.advanceTimersByTime(30 * 60_000 + 1_000);
      mockDb._selectChain.from.mockRejectedValue(new Error('DB down'));
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(2);

      // cacheLoadedAt was NOT updated on failure, so next get() retries
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'recovered'),
      ]);
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(3);
      expect(result).toBe('recovered');
    });
  });
}
describe('SettingsService — ROK-698 background cache refresh', () =>
  describeSettingsServiceROK698BackgroundRefresh());
