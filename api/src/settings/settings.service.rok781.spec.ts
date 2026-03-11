/**
 * ROK-781: Regression test — ITAD API key not available during Steam sync.
 *
 * Root cause: ensureCache() did not await the reload when TTL expired on a
 * warm cache, so concurrent reads during the reload window got stale/empty
 * results. The fix makes ensureCache() always await when TTL has expired.
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

function describeSettingsServiceROK781() {
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
    process.env.JWT_SECRET = 'test-jwt-secret-for-rok781-settings-tests';

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
  // Core regression: get() returns correct value after TTL expiry
  // ============================================================
  describe('get() after TTL expiry always returns fresh data', () => {
    it('returns reloaded ITAD key after TTL expires during sync', async () => {
      jest.useFakeTimers();

      // Simulate app startup: cache loaded with ITAD key configured
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key-abc'),
        makeRow(SETTING_KEYS.STEAM_API_KEY, 'steam-key-xyz'),
      ]);
      await service.get(SETTING_KEYS.ITAD_API_KEY);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Simulate a long-running Steam sync: TTL expires mid-sync
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // DB still has both keys (they haven't changed)
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key-abc'),
        makeRow(SETTING_KEYS.STEAM_API_KEY, 'steam-key-xyz'),
      ]);

      // The bug: before ROK-781 fix, this would return null because
      // ensureCache() didn't await the reload on warm cache expiry,
      // and the old cache was being replaced by loadCache().
      const itadKey = await service.get(SETTING_KEYS.ITAD_API_KEY);
      expect(itadKey).toBe('itad-key-abc');

      // Reload was triggered and completed
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('exists() returns true for ITAD key after TTL expires', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key-abc'),
      ]);
      await service.exists(SETTING_KEYS.ITAD_API_KEY);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key-abc'),
      ]);

      const result = await service.exists(SETTING_KEYS.ITAD_API_KEY);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // Concurrent reads during TTL expiry all get fresh data
  // ============================================================
  describe('concurrent reads during TTL expiry', () => {
    it('all concurrent get() calls receive fresh data', async () => {
      jest.useFakeTimers();

      // Initial load
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key'),
        makeRow(SETTING_KEYS.STEAM_API_KEY, 'steam-key'),
      ]);
      await service.get(SETTING_KEYS.ITAD_API_KEY);

      // Expire TTL
      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Reload returns updated data
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key-v2'),
        makeRow(SETTING_KEYS.STEAM_API_KEY, 'steam-key-v2'),
      ]);

      // Simulate concurrent reads (as during Steam sync)
      const [itad, steam] = await Promise.all([
        service.get(SETTING_KEYS.ITAD_API_KEY),
        service.get(SETTING_KEYS.STEAM_API_KEY),
      ]);

      expect(itad).toBe('itad-key-v2');
      expect(steam).toBe('steam-key-v2');

      // Only one reload triggered
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // No performance regression for non-expired cache
  // ============================================================
  describe('no performance regression', () => {
    it('does not reload when cache is within TTL', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key'),
      ]);

      // Initial load
      await service.get(SETTING_KEYS.ITAD_API_KEY);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Many reads within TTL window
      jest.advanceTimersByTime(15 * 60_000);
      await service.get(SETTING_KEYS.ITAD_API_KEY);
      await service.get(SETTING_KEYS.ITAD_API_KEY);
      await service.get(SETTING_KEYS.ITAD_API_KEY);

      // No additional DB calls
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('reload deduplication prevents thundering herd', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.ITAD_API_KEY, 'itad-key'),
      ]);
      await service.get(SETTING_KEYS.ITAD_API_KEY);

      jest.advanceTimersByTime(30 * 60_000 + 1_000);

      // Slow reload
      let resolveReload!: (v: unknown[]) => void;
      mockDb._selectChain.from.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveReload = resolve;
          }),
      );

      // Fire many concurrent reads
      const promises = Array.from({ length: 10 }, () =>
        service.get(SETTING_KEYS.ITAD_API_KEY),
      );

      // Only one DB call despite 10 concurrent reads
      expect(mockDb.select).toHaveBeenCalledTimes(2);

      // Resolve and verify all get the fresh value
      resolveReload([makeRow(SETTING_KEYS.ITAD_API_KEY, 'fresh')]);
      const results = await Promise.all(promises);
      expect(results.every((r) => r === 'fresh')).toBe(true);
    });
  });
}
describe('SettingsService — ROK-781 ITAD key availability', () =>
  describeSettingsServiceROK781());
