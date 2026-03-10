/**
 * ROK-698: Unit tests for background cache refresh behavior.
 * Verifies that expired TTL triggers a non-blocking background refresh
 * so cron jobs and HTTP requests are never stalled by decryption.
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
  // Background refresh: stale cache served while reloading
  // ============================================================
  describe('background refresh after TTL expiry', () => {
    it('returns stale cached value immediately when TTL has expired', async () => {
      jest.useFakeTimers();

      // Initial cache load with a known value
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'initial-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Set up a slow DB response for the background refresh
      let resolveRefresh!: (value: unknown[]) => void;
      mockDb._selectChain.from.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      // This get() should return the stale value immediately,
      // not block on the background refresh
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('initial-value');

      // The background DB query was started
      expect(mockDb.select).toHaveBeenCalledTimes(2);

      // Resolve the background refresh
      resolveRefresh([makeRow(SETTING_KEYS.DEMO_MODE, 'refreshed-value')]);

      // Allow microtasks to settle
      await jest.advanceTimersByTimeAsync(0);
    });

    it('serves refreshed data after background reload completes', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'old-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Background refresh returns new value
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'new-value'),
      ]);

      // Trigger background refresh (returns stale value)
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Allow background refresh to complete
      await jest.advanceTimersByTimeAsync(0);

      // Now should serve the refreshed value
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('new-value');
    });

    it('does not trigger multiple background reloads for concurrent reads', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'cached'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Slow background refresh
      let resolveRefresh!: (value: unknown[]) => void;
      mockDb._selectChain.from.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      // Multiple concurrent get() calls after TTL expiry
      const results = await Promise.all([
        service.get(SETTING_KEYS.DEMO_MODE),
        service.get(SETTING_KEYS.DEMO_MODE),
        service.get(SETTING_KEYS.DEMO_MODE),
      ]);

      // All should return stale value immediately
      expect(results).toEqual(['cached', 'cached', 'cached']);

      // Only one background DB query should have been triggered
      expect(mockDb.select).toHaveBeenCalledTimes(2);

      // Cleanup
      resolveRefresh([makeRow(SETTING_KEYS.DEMO_MODE, 'refreshed')]);
      await jest.advanceTimersByTimeAsync(0);
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
  describe('background refresh error handling', () => {
    it('continues serving stale cache when background refresh fails', async () => {
      jest.useFakeTimers();

      // Initial load succeeds
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'stable-value'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Background refresh fails
      mockDb._selectChain.from.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Should still return the stale cached value
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('stable-value');

      // Allow error to propagate in background
      await jest.advanceTimersByTimeAsync(0);
    });

    it('retries background refresh on next TTL cycle after a failure', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'original'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // First TTL expiry - background refresh fails
      jest.advanceTimersByTime(30 * 60_000 + 1_000);
      mockDb._selectChain.from.mockRejectedValue(new Error('DB down'));
      await service.get(SETTING_KEYS.DEMO_MODE);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockDb.select).toHaveBeenCalledTimes(2);

      // Second TTL expiry - should attempt refresh again
      jest.advanceTimersByTime(30 * 60_000 + 1_000);
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'recovered'),
      ]);
      await service.get(SETTING_KEYS.DEMO_MODE);
      await jest.advanceTimersByTimeAsync(0);
      expect(mockDb.select).toHaveBeenCalledTimes(3);

      // Now should serve the recovered value
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('recovered');
    });
  });
}
describe('SettingsService — ROK-698 background cache refresh', () =>
  describeSettingsServiceROK698BackgroundRefresh());
