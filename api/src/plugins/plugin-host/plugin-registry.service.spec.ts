/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginManifest, PLUGIN_EVENTS } from './plugin-manifest.interface';

function thenableResult(data: unknown[]) {
  const obj: any = {
    then: (resolve: any, reject?: any) =>
      Promise.resolve(data).then(resolve, reject),
    limit: jest.fn().mockImplementation(() => thenableResult(data)),
  };
  return obj;
}

const testManifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: { name: 'Test Author' },
  gameSlugs: ['test-game'],
  capabilities: ['test-cap'],
  settingKeys: ['test_setting_1'],
  integrations: [
    {
      key: 'test-api',
      name: 'Test API',
      description: 'A test integration',
      credentialKeys: ['test_client_id', 'test_client_secret'],
      credentialLabels: ['Client ID', 'Client Secret'],
      settingsEvent: 'settings.test.updated',
    },
  ],
};

const depManifest: PluginManifest = {
  id: 'dep-plugin',
  name: 'Dependent Plugin',
  version: '1.0.0',
  description: 'Depends on test-plugin',
  author: { name: 'Test Author' },
  gameSlugs: [],
  capabilities: [],
  dependencies: ['test-plugin'],
};

const noGameManifest: PluginManifest = {
  id: 'no-game-plugin',
  name: 'Non-Game Plugin',
  version: '1.0.0',
  description: 'A plugin without gameSlugs',
  author: { name: 'Test Author' },
  capabilities: ['auth-provider'],
};

describe('PluginRegistryService', () => {
  let service: PluginRegistryService;
  let mockDb: Record<string, jest.Mock>;
  let mockEventEmitter: { emit: jest.Mock };

  let selectResults: unknown[];
  let insertReturning: unknown[];
  let deleteWhereFn: jest.Mock;
  let updateSetFn: jest.Mock;

  beforeEach(async () => {
    selectResults = [];
    insertReturning = [];
    deleteWhereFn = jest.fn().mockResolvedValue(undefined);
    updateSetFn = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });

    mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          const fromResult = thenableResult(selectResults);
          fromResult.where = jest
            .fn()
            .mockImplementation(() => thenableResult(selectResults));
          return fromResult;
        }),
      })),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockImplementation(() => insertReturning),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: deleteWhereFn,
      }),
      update: jest.fn().mockReturnValue({
        set: updateSetFn,
      }),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PluginRegistryService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<PluginRegistryService>(PluginRegistryService);

    // onModuleInit calls refreshActiveCache, which does a DB select.
    // Reset mocks after init so test assertions start clean.
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerManifest()', () => {
    it('should store manifest in memory', () => {
      service.registerManifest(testManifest);
      expect(service.getManifest('test-plugin')).toBe(testManifest);
    });

    it('should overwrite existing manifest with same id', () => {
      service.registerManifest(testManifest);
      const updated = { ...testManifest, version: '2.0.0' };
      service.registerManifest(updated);
      expect(service.getManifest('test-plugin')?.version).toBe('2.0.0');
    });
  });

  describe('listPlugins()', () => {
    it('should return empty array when no manifests registered', async () => {
      const result = await service.listPlugins();
      expect(result).toEqual([]);
    });

    it('should merge manifests with DB records', async () => {
      service.registerManifest(testManifest);

      const installedAt = new Date('2025-01-01T00:00:00Z');
      const pluginRecords = [
        {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          active: true,
          installedAt,
        },
      ];

      let fromCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          fromCallCount++;
          if (fromCallCount === 1) {
            // select().from(plugins) — bare call for all records
            return thenableResult(pluginRecords);
          }
          // Batch credential check — return no keys configured
          const r = thenableResult([]);
          r.where = jest.fn().mockImplementation(() => thenableResult([]));
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('test-plugin');
      expect(result[0].status).toBe('active');
      expect(result[0].installedAt).toBe(installedAt.toISOString());
    });

    it('should include author from manifest', async () => {
      service.registerManifest(testManifest);

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          const r = thenableResult([]);
          r.where = jest.fn().mockImplementation(() => thenableResult([]));
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result[0].author).toEqual({ name: 'Test Author' });
    });

    it('should return not_installed for manifests without DB records', async () => {
      service.registerManifest(testManifest);

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          const r = thenableResult([]);
          r.where = jest.fn().mockImplementation(() => thenableResult([]));
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result[0].status).toBe('not_installed');
      expect(result[0].installedAt).toBeNull();
    });

    it('should resolve configured flag for integrations', async () => {
      service.registerManifest(testManifest);

      let fromCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          fromCallCount++;
          if (fromCallCount === 1) {
            // plugins table — not installed
            return thenableResult([]);
          }
          // Batch credential check — both keys exist
          const r = thenableResult([
            { key: 'test_client_id' },
            { key: 'test_client_secret' },
          ]);
          r.where = jest
            .fn()
            .mockImplementation(() =>
              thenableResult([
                { key: 'test_client_id' },
                { key: 'test_client_secret' },
              ]),
            );
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result[0].integrations[0].configured).toBe(true);
    });

    it('should set configured=false when any credential key is missing', async () => {
      service.registerManifest(testManifest);

      let fromCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          fromCallCount++;
          if (fromCallCount === 1) {
            // plugins table — not installed
            return thenableResult([]);
          }
          // Batch credential check — only one key exists
          const r = thenableResult([{ key: 'test_client_id' }]);
          r.where = jest
            .fn()
            .mockImplementation(() =>
              thenableResult([{ key: 'test_client_id' }]),
            );
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result[0].integrations[0].configured).toBe(false);
    });
  });

  describe('install()', () => {
    it('should create DB record and emit INSTALLED event', async () => {
      service.registerManifest(testManifest);

      const installedAt = new Date();
      insertReturning = [
        {
          id: 1,
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          active: true,
          installedAt,
          updatedAt: installedAt,
        },
      ];

      const record = await service.install('test-plugin');
      expect(record.slug).toBe('test-plugin');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PLUGIN_EVENTS.INSTALLED,
        { slug: 'test-plugin', manifest: testManifest },
      );
    });

    it('should throw NotFoundException if manifest not found', async () => {
      await expect(service.install('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if already installed', async () => {
      service.registerManifest(testManifest);
      selectResults = [{ slug: 'test-plugin' }];

      await expect(service.install('test-plugin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should check dependencies are installed first', async () => {
      service.registerManifest(testManifest);
      service.registerManifest(depManifest);

      // Both selects (existing check + dep check) return empty
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => thenableResult([])),
        })),
      }));

      await expect(service.install('dep-plugin')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('uninstall()', () => {
    it('should delete DB record, clean settings, and emit event', async () => {
      service.registerManifest(testManifest);

      selectResults = [{ slug: 'test-plugin', active: false }];

      await service.uninstall('test-plugin');
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PLUGIN_EVENTS.UNINSTALLED,
        { slug: 'test-plugin' },
      );
    });

    it('should throw NotFoundException if not installed', async () => {
      selectResults = [];
      await expect(service.uninstall('test-plugin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if plugin is active', async () => {
      selectResults = [{ slug: 'test-plugin', active: true }];
      await expect(service.uninstall('test-plugin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should clean up settingKeys and integration credentialKeys', async () => {
      service.registerManifest(testManifest);
      selectResults = [{ slug: 'test-plugin', active: false }];

      await service.uninstall('test-plugin');

      // 3 setting key deletes + 1 plugin record delete = 4 calls
      // Keys: test_setting_1, test_client_id, test_client_secret, plugins record
      expect(mockDb.delete).toHaveBeenCalledTimes(4);
    });
  });

  describe('activate()', () => {
    it('should set active=true and emit ACTIVATED event', async () => {
      selectResults = [{ slug: 'test-plugin', active: false }];

      await service.activate('test-plugin');
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PLUGIN_EVENTS.ACTIVATED,
        { slug: 'test-plugin' },
      );
    });

    it('should throw NotFoundException if not installed', async () => {
      selectResults = [];
      await expect(service.activate('test-plugin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should be a no-op if already active', async () => {
      selectResults = [{ slug: 'test-plugin', active: true }];

      await service.activate('test-plugin');
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('deactivate()', () => {
    it('should set active=false and emit DEACTIVATED event', async () => {
      selectResults = [{ slug: 'test-plugin', active: true }];

      await service.deactivate('test-plugin');
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PLUGIN_EVENTS.DEACTIVATED,
        { slug: 'test-plugin' },
      );
    });

    it('should throw NotFoundException if not installed', async () => {
      selectResults = [];
      await expect(service.deactivate('test-plugin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should be a no-op if already inactive', async () => {
      selectResults = [{ slug: 'test-plugin', active: false }];

      await service.deactivate('test-plugin');
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should remove adapters for the plugin gameSlugs on deactivation', async () => {
      service.registerManifest(testManifest);

      // Register adapters for the manifest's gameSlugs
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'test-game', adapter);
      expect(service.getAdapter('character-sync', 'test-game')).toBe(adapter);

      selectResults = [{ slug: 'test-plugin', active: true }];

      await service.deactivate('test-plugin');

      // Adapter should be removed after deactivation
      expect(service.getAdapter('character-sync', 'test-game')).toBeUndefined();
    });
  });

  describe('ensureInstalled()', () => {
    it('should auto-install a registered manifest if not in DB', async () => {
      service.registerManifest(testManifest);
      selectResults = [];

      insertReturning = [
        {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          active: true,
        },
      ];

      await service.ensureInstalled('test-plugin');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should no-op if plugin already in DB', async () => {
      service.registerManifest(testManifest);
      selectResults = [{ slug: 'test-plugin', active: true }];

      await service.ensureInstalled('test-plugin');
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should no-op if manifest not registered', async () => {
      await service.ensureInstalled('nonexistent');
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('isActive()', () => {
    it('should return false when plugin is not in active cache', () => {
      expect(service.isActive('test-plugin')).toBe(false);
    });

    it('should return true after activating a plugin', async () => {
      // Simulate install so cache gets refreshed with active plugin
      service.registerManifest(testManifest);

      const installedAt = new Date();
      insertReturning = [
        {
          id: 1,
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          active: true,
          installedAt,
          updatedAt: installedAt,
        },
      ];

      // After install, refreshActiveCache is called — mock it to return the slug
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            selectCallCount++;
            // First call: check existing (should be empty)
            if (selectCallCount === 1) return thenableResult([]);
            // Subsequent calls (refreshActiveCache): return active slugs
            return thenableResult([{ slug: 'test-plugin' }]);
          }),
        })),
      }));

      await service.install('test-plugin');
      expect(service.isActive('test-plugin')).toBe(true);
    });
  });

  describe('getActiveSlugsSync()', () => {
    it('should return empty set initially', () => {
      expect(service.getActiveSlugsSync().size).toBe(0);
    });
  });

  describe('registerAdapter()', () => {
    it('should store and retrieve an adapter by extension point and game slug', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);

      const result = service.getAdapter('character-sync', 'world-of-warcraft');
      expect(result).toBe(adapter);
    });

    it('should return undefined for unregistered adapter', () => {
      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBeUndefined();
    });

    it('should allow multiple game slugs for same extension point', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
      service.registerAdapter('character-sync', 'world-of-warcraft-classic', adapter);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(adapter);
      expect(service.getAdapter('character-sync', 'world-of-warcraft-classic')).toBe(adapter);
    });

    it('should allow different adapters for different extension points', () => {
      const syncAdapter = { fetchProfile: jest.fn() };
      const contentAdapter = { fetchRealms: jest.fn() };

      service.registerAdapter('character-sync', 'world-of-warcraft', syncAdapter);
      service.registerAdapter('content-provider', 'world-of-warcraft', contentAdapter);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(syncAdapter);
      expect(service.getAdapter('content-provider', 'world-of-warcraft')).toBe(
        contentAdapter,
      );
    });

    it('should overwrite existing adapter for same extension point and slug', () => {
      const adapter1 = { fetchProfile: jest.fn() };
      const adapter2 = { fetchProfile: jest.fn() };

      service.registerAdapter('character-sync', 'world-of-warcraft', adapter1);
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter2);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(adapter2);
    });
  });

  describe('getAdaptersForExtensionPoint()', () => {
    it('should return empty map when no adapters registered', () => {
      const result = service.getAdaptersForExtensionPoint('character-sync');
      expect(result.size).toBe(0);
    });

    it('should return all adapters for an extension point', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
      service.registerAdapter('character-sync', 'world-of-warcraft-classic', adapter);

      const result = service.getAdaptersForExtensionPoint('character-sync');
      expect(result.size).toBe(2);
      expect(result.get('world-of-warcraft')).toBe(adapter);
      expect(result.get('world-of-warcraft-classic')).toBe(adapter);
    });
  });

  describe('removeAdaptersForPlugin()', () => {
    it('should remove adapters for specified game slugs', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
      service.registerAdapter('character-sync', 'world-of-warcraft-classic', adapter);
      service.registerAdapter('content-provider', 'world-of-warcraft', adapter);

      service.removeAdaptersForPlugin(['world-of-warcraft', 'world-of-warcraft-classic']);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBeUndefined();
      expect(
        service.getAdapter('character-sync', 'world-of-warcraft-classic'),
      ).toBeUndefined();
      expect(service.getAdapter('content-provider', 'world-of-warcraft')).toBeUndefined();
    });

    it('should not affect adapters for other game slugs', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
      service.registerAdapter('character-sync', 'final-fantasy-xiv-online', adapter);

      service.removeAdaptersForPlugin(['world-of-warcraft']);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBeUndefined();
      expect(service.getAdapter('character-sync', 'final-fantasy-xiv-online')).toBe(adapter);
    });

    it('should handle undefined gameSlugs gracefully', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);

      service.removeAdaptersForPlugin();

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(adapter);
    });
  });

  describe('refreshActiveCache() — missing plugins table (ROK-363)', () => {
    it('should start with empty activeSlugs when plugins table does not exist', async () => {
      // Create a fresh service where onModuleInit hits a "table missing" error
      const pgError = new Error(
        'relation "plugins" does not exist',
      ) as Error & { code: string };
      pgError.code = '42P01'; // PostgreSQL "undefined_table" error code

      const failDb = {
        ...mockDb,
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockRejectedValue(pgError),
          })),
        })),
      };

      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          PluginRegistryService,
          { provide: DrizzleAsyncProvider, useValue: failDb },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();

      const failService = failModule.get<PluginRegistryService>(
        PluginRegistryService,
      );

      // Service should have started without throwing
      expect(failService.isActive('anything')).toBe(false);
      expect(failService.getActiveSlugsSync().size).toBe(0);
    });

    it('should re-throw non-table-missing database errors', async () => {
      const otherError = new Error('connection refused') as Error & {
        code: string;
      };
      otherError.code = '08006'; // PostgreSQL "connection_failure" code

      // Override the mock DB to throw on the next select call
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockRejectedValue(otherError),
        })),
      }));

      await expect(service.onModuleInit()).rejects.toThrow(
        'connection refused',
      );
    });

    it('should log the expected warning message when plugins table is missing', async () => {
      const pgError = new Error(
        'relation "plugins" does not exist',
      ) as Error & { code: string };
      pgError.code = '42P01';

      const failDb = {
        ...mockDb,
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockImplementation(() => ({
            where: jest.fn().mockRejectedValue(pgError),
          })),
        })),
      };

      const failModule: TestingModule = await Test.createTestingModule({
        providers: [
          PluginRegistryService,
          { provide: DrizzleAsyncProvider, useValue: failDb },
          { provide: EventEmitter2, useValue: mockEventEmitter },
        ],
      }).compile();

      const failService = failModule.get<PluginRegistryService>(
        PluginRegistryService,
      );

      // Spy on the logger after module construction to capture the warn call
      // The warn was already called during onModuleInit — we re-trigger via a
      // public method that calls refreshActiveCache to verify the message.
      const loggerWarnSpy = jest
        .spyOn(failService['logger'], 'warn')
        .mockImplementation(() => undefined);

      // Trigger again by calling onModuleInit directly
      await failService.onModuleInit();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'plugins table not found — plugin system disabled until migration is applied',
      );
    });

    it('should re-throw a plain Error that has no code property', async () => {
      const plainError = new Error('unexpected query error');
      // Deliberately no .code property

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockRejectedValue(plainError),
        })),
      }));

      await expect(service.onModuleInit()).rejects.toThrow(
        'unexpected query error',
      );
    });

    it('should re-throw a non-Error thrown value (e.g. a string)', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockRejectedValue('string error'),
        })),
      }));

      await expect(service.onModuleInit()).rejects.toBe('string error');
    });

    it('should populate activeSlugs normally when plugins table exists', async () => {
      // Mock the DB to return two active slugs on refreshActiveCache
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest
            .fn()
            .mockResolvedValue([{ slug: 'plugin-a' }, { slug: 'plugin-b' }]),
        })),
      }));

      await service.onModuleInit();

      expect(service.isActive('plugin-a')).toBe(true);
      expect(service.isActive('plugin-b')).toBe(true);
      expect(service.isActive('plugin-c')).toBe(false);
      expect(service.getActiveSlugsSync().size).toBe(2);
    });
  });

  describe('manifest without gameSlugs (ROK-265)', () => {
    it('should register manifest without gameSlugs', () => {
      service.registerManifest(noGameManifest);
      const manifest = service.getManifest('no-game-plugin');
      expect(manifest).toBeDefined();
      expect(manifest!.gameSlugs).toBeUndefined();
    });

    it('should deactivate plugin without gameSlugs without error', async () => {
      service.registerManifest(noGameManifest);
      selectResults = [{ slug: 'no-game-plugin', active: true }];

      await service.deactivate('no-game-plugin');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        PLUGIN_EVENTS.DEACTIVATED,
        { slug: 'no-game-plugin' },
      );
    });

    it('should list plugin without gameSlugs with empty array', async () => {
      service.registerManifest(noGameManifest);

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          const r = thenableResult([]);
          r.where = jest.fn().mockImplementation(() => thenableResult([]));
          return r;
        }),
      }));

      const result = await service.listPlugins();
      expect(result[0].gameSlugs).toEqual([]);
    });
  });
});
