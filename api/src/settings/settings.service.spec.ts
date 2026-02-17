/**
 * ROK-365: Unit tests for SettingsService cache behavior.
 * Verifies the in-memory Map cache with 60s TTL, write-through on set(),
 * cache clear on delete(), concurrent load coalescing, and TTL expiry.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from './settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SETTING_KEYS } from '../drizzle/schema';
import { encrypt } from './encryption.util';

/** Build a DB row as returned by drizzle select().from(appSettings). */
function makeRow(key: string, value: string) {
  return { key, encryptedValue: encrypt(value), updatedAt: new Date(), createdAt: new Date(), id: 1 };
}

describe('SettingsService — ROK-365 cache behavior', () => {
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
    process.env.JWT_SECRET = 'test-jwt-secret-for-settings-cache-tests';

    // Build a chainable drizzle mock
    mockDb = {
      _selectChain: { from: jest.fn() },
      _insertChain: { values: jest.fn() },
      _deleteChain: { where: jest.fn() },
      _insertValuesChain: { onConflictDoUpdate: jest.fn().mockResolvedValue([]) },
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
  // Cache population: single DB load for all settings
  // ============================================================
  describe('cache population', () => {
    it('loads all settings from DB in a single query on first get()', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'id-value'),
        makeRow(SETTING_KEYS.DISCORD_CLIENT_SECRET, 'secret-value'),
      ]);

      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('returns the correct value from the loaded cache', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'my-client-id'),
      ]);

      const result = await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);
      expect(result).toBe('my-client-id');
    });

    it('returns null for a key not present in DB after cache is loaded', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'some-value'),
      ]);

      // Populate cache
      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      // Key not in DB → should be null, no extra DB call
      const result = await service.get(SETTING_KEYS.IGDB_CLIENT_ID);
      expect(result).toBeNull();
      // Still only one DB round-trip
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('serves subsequent reads from cache without extra DB calls', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'true'),
      ]);

      await service.get(SETTING_KEYS.DEMO_MODE);
      await service.get(SETTING_KEYS.DEMO_MODE);
      await service.get(SETTING_KEYS.DEMO_MODE);

      // Only one DB load regardless of how many get() calls
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('populates the cache with ALL settings from DB, not just the requested key', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'id-val'),
        makeRow(SETTING_KEYS.DISCORD_CLIENT_SECRET, 'secret-val'),
        makeRow(SETTING_KEYS.DEMO_MODE, 'false'),
      ]);

      // Request only one key
      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      // Other keys must be available without another DB hit
      const secret = await service.get(SETTING_KEYS.DISCORD_CLIENT_SECRET);
      const demo = await service.get(SETTING_KEYS.DEMO_MODE);

      expect(secret).toBe('secret-val');
      expect(demo).toBe('false');
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Cache invalidation on set()
  // ============================================================
  describe('cache invalidation on set()', () => {
    it('write-through: get() returns new value immediately after set()', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'old-value'),
      ]);

      // Populate cache
      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      // Update via set()
      await service.set(SETTING_KEYS.DISCORD_CLIENT_ID, 'new-value');

      // Must reflect new value without needing a DB reload
      const result = await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);
      expect(result).toBe('new-value');
    });

    it('set() writes to DB', async () => {
      await service.set(SETTING_KEYS.DEMO_MODE, 'true');

      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb._insertChain.values).toHaveBeenCalledTimes(1);
      expect(mockDb._insertValuesChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });

    it('set() on a new key makes it available via get() without DB reload', async () => {
      // Empty DB → cache loaded with no entries
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID); // triggers cache load

      // Now set a new key
      await service.set(SETTING_KEYS.DEMO_MODE, 'true');

      // Should be available from cache, no extra select
      const result = await service.get(SETTING_KEYS.DEMO_MODE);
      expect(result).toBe('true');
      expect(mockDb.select).toHaveBeenCalledTimes(1); // still only the original load
    });

    it('exists() returns true for a key added via set()', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DEMO_MODE);

      await service.set(SETTING_KEYS.DEMO_MODE, 'true');

      const exists = await service.exists(SETTING_KEYS.DEMO_MODE);
      expect(exists).toBe(true);
    });
  });

  // ============================================================
  // Cache invalidation on delete()
  // ============================================================
  describe('cache invalidation on delete()', () => {
    it('delete() removes key from cache immediately', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'some-id'),
      ]);

      // Populate cache
      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      // Delete
      await service.delete(SETTING_KEYS.DISCORD_CLIENT_ID);

      // Key must be gone from cache; fresh reload still won't have it
      mockDb._selectChain.from.mockResolvedValue([]); // DB now empty too

      // Cache is still fresh — should serve from stale cache but key is gone
      const result = await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);
      expect(result).toBeNull();
    });

    it('delete() removes key from DB', async () => {
      await service.delete(SETTING_KEYS.DISCORD_CLIENT_ID);

      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      expect(mockDb._deleteChain.where).toHaveBeenCalledTimes(1);
    });

    it('exists() returns false for a deleted key without DB reload', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.GITHUB_PAT, 'ghp_token'),
      ]);

      await service.get(SETTING_KEYS.GITHUB_PAT);
      await service.delete(SETTING_KEYS.GITHUB_PAT);

      const exists = await service.exists(SETTING_KEYS.GITHUB_PAT);
      expect(exists).toBe(false);
      // No extra DB round-trips needed
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('get() returns null for a key that does not exist after cache is populated', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'id'),
      ]);

      await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);

      const missingKey = await service.get(SETTING_KEYS.IGDB_CLIENT_SECRET);
      expect(missingKey).toBeNull();
    });
  });

  // ============================================================
  // TTL expiry — cache reloads from DB after 60 seconds
  // ============================================================
  describe('TTL expiry', () => {
    it('does NOT reload DB while cache is within 60s TTL', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'false'),
      ]);

      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Advance 59 seconds — still within TTL
      jest.advanceTimersByTime(59_000);

      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('reloads from DB after TTL (60s) expires', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'false'),
      ]);

      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Advance past 60 second TTL
      jest.advanceTimersByTime(61_000);

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'true'),
      ]);

      const result = await service.get(SETTING_KEYS.DEMO_MODE);

      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(result).toBe('true');
    });

    it('returns updated value from DB after TTL expires', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.COMMUNITY_NAME, 'OldName'),
      ]);

      const first = await service.get(SETTING_KEYS.COMMUNITY_NAME);
      expect(first).toBe('OldName');

      jest.advanceTimersByTime(65_000);

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.COMMUNITY_NAME, 'NewName'),
      ]);

      const second = await service.get(SETTING_KEYS.COMMUNITY_NAME);
      expect(second).toBe('NewName');
    });
  });

  // ============================================================
  // Concurrent load coalescing
  // ============================================================
  describe('concurrent load coalescing', () => {
    it('multiple simultaneous get() calls trigger only one DB load', async () => {
      let resolveLoad!: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      mockDb._selectChain.from.mockImplementation(() =>
        loadPromise.then(() => [
          makeRow(SETTING_KEYS.DISCORD_CLIENT_ID, 'coalesced-id'),
        ]),
      );

      // Fire 5 concurrent gets without awaiting
      const promises = [
        service.get(SETTING_KEYS.DISCORD_CLIENT_ID),
        service.get(SETTING_KEYS.DISCORD_CLIENT_ID),
        service.get(SETTING_KEYS.DISCORD_CLIENT_ID),
        service.get(SETTING_KEYS.DISCORD_CLIENT_SECRET),
        service.get(SETTING_KEYS.DEMO_MODE),
      ];

      // Allow DB load to complete
      resolveLoad();
      const results = await Promise.all(promises);

      // Only one DB round-trip despite 5 concurrent calls
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // First three should return the seeded value; others null (not in DB)
      expect(results[0]).toBe('coalesced-id');
      expect(results[1]).toBe('coalesced-id');
      expect(results[2]).toBe('coalesced-id');
      expect(results[3]).toBeNull();
      expect(results[4]).toBeNull();
    });

    it('cacheLoadPromise is reset to null after load completes (allows future reloads)', async () => {
      jest.useFakeTimers();

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'false'),
      ]);

      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(1);

      // Expire TTL, triggering a second load
      jest.advanceTimersByTime(61_000);

      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'true'),
      ]);

      await service.get(SETTING_KEYS.DEMO_MODE);
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // exists() uses cache
  // ============================================================
  describe('exists()', () => {
    it('returns true when key is in cache', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.GITHUB_PAT, 'token'),
      ]);

      const result = await service.exists(SETTING_KEYS.GITHUB_PAT);
      expect(result).toBe(true);
    });

    it('returns false when key is absent from cache', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.exists(SETTING_KEYS.GITHUB_PAT);
      expect(result).toBe(false);
    });

    it('does not trigger additional DB calls for subsequent exists() checks', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.GITHUB_PAT, 'token'),
      ]);

      await service.exists(SETTING_KEYS.GITHUB_PAT);
      await service.exists(SETTING_KEYS.DISCORD_CLIENT_ID);
      await service.exists(SETTING_KEYS.DEMO_MODE);

      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Decrypt failure during cache load
  // ============================================================
  describe('decrypt failure resilience', () => {
    it('skips a malformed row and still caches other rows', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        // Malformed encrypted value — decrypt will throw
        { key: SETTING_KEYS.DISCORD_CLIENT_ID, encryptedValue: 'BAD_VALUE', updatedAt: new Date(), createdAt: new Date(), id: 1 },
        makeRow(SETTING_KEYS.DEMO_MODE, 'true'),
      ]);

      const discordId = await service.get(SETTING_KEYS.DISCORD_CLIENT_ID);
      const demoMode = await service.get(SETTING_KEYS.DEMO_MODE);

      // Malformed row is skipped, returns null
      expect(discordId).toBeNull();
      // Valid row is still cached
      expect(demoMode).toBe('true');
      // Only one DB load
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Integration: getDemoMode / setDemoMode flow
  // ============================================================
  describe('getDemoMode / setDemoMode', () => {
    it('getDemoMode returns false when setting is absent', async () => {
      mockDb._selectChain.from.mockResolvedValue([]);

      const result = await service.getDemoMode();
      expect(result).toBe(false);
    });

    it('getDemoMode returns true after setDemoMode(true) when cache is already loaded', async () => {
      // Pre-load cache (necessary because loadCache() replaces the entire cache map,
      // so set() before ensureCache() runs would be overwritten on first read)
      mockDb._selectChain.from.mockResolvedValue([]);
      await service.get(SETTING_KEYS.DEMO_MODE); // trigger initial cache load

      await service.setDemoMode(true);
      const result = await service.getDemoMode();

      expect(result).toBe(true);
    });

    it('getDemoMode returns false after setDemoMode(false)', async () => {
      mockDb._selectChain.from.mockResolvedValue([
        makeRow(SETTING_KEYS.DEMO_MODE, 'true'),
      ]);

      await service.getDemoMode(); // load cache
      await service.setDemoMode(false);
      const result = await service.getDemoMode();

      expect(result).toBe(false);
    });
  });
});
