import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginManifest, PLUGIN_EVENTS } from './plugin-manifest.interface';

interface ThenableQueryResult {
  then: (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  limit: jest.Mock;
  where?: jest.Mock;
}

function thenableResult(data: unknown[]): ThenableQueryResult {
  const obj: ThenableQueryResult = {
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(data).then(resolve, reject),
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

let service: PluginRegistryService;
let mockDb: Record<string, jest.Mock>;
let mockEventEmitter: { emit: jest.Mock };

let selectResults: unknown[];
let insertReturning: unknown[];
let deleteWhereFn: jest.Mock;
let updateSetFn: jest.Mock;

function buildMockDb() {
  return {
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
    delete: jest.fn().mockReturnValue({ where: deleteWhereFn }),
    update: jest.fn().mockReturnValue({ set: updateSetFn }),
  };
}

async function setupEach() {
  selectResults = [];
  insertReturning = [];
  deleteWhereFn = jest.fn().mockResolvedValue(undefined);
  updateSetFn = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });

  mockDb = buildMockDb();
  mockEventEmitter = { emit: jest.fn() };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PluginRegistryService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: EventEmitter2, useValue: mockEventEmitter },
    ],
  }).compile();

  service = module.get<PluginRegistryService>(PluginRegistryService);
  jest.clearAllMocks();
}

function mockSelectWithCredentials(
  pluginRecords: unknown[],
  credentialKeys: unknown[],
) {
  let fromCallCount = 0;
  mockDb.select.mockImplementation(() => ({
    from: jest.fn().mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) return thenableResult(pluginRecords);
      const r = thenableResult(credentialKeys);
      r.where = jest
        .fn()
        .mockImplementation(() => thenableResult(credentialKeys));
      return r;
    }),
  }));
}

async function testListPluginsMerge() {
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
  mockSelectWithCredentials(pluginRecords, []);

  const result = await service.listPlugins();
  expect(result).toHaveLength(1);
  expect(result[0].slug).toBe('test-plugin');
  expect(result[0].status).toBe('active');
  expect(result[0].installedAt).toBe(installedAt.toISOString());
}

async function testConfiguredFlag() {
  service.registerManifest(testManifest);
  const bothKeys = [{ key: 'test_client_id' }, { key: 'test_client_secret' }];
  mockSelectWithCredentials([], bothKeys);

  const result = await service.listPlugins();
  expect(result[0].integrations[0].configured).toBe(true);
}

async function testConfiguredFalseWhenKeyMissing() {
  service.registerManifest(testManifest);
  mockSelectWithCredentials([], [{ key: 'test_client_id' }]);

  const result = await service.listPlugins();
  expect(result[0].integrations[0].configured).toBe(false);
}

async function testInstallEmitsEvent() {
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
  expect(mockEventEmitter.emit).toHaveBeenCalledWith(PLUGIN_EVENTS.INSTALLED, {
    slug: 'test-plugin',
    manifest: testManifest,
  });
}

async function testDeactivateRemovesAdapters() {
  service.registerManifest(testManifest);
  const adapter = { fetchProfile: jest.fn() };
  service.registerAdapter('character-sync', 'test-game', adapter);
  expect(service.getAdapter('character-sync', 'test-game')).toBe(adapter);

  selectResults = [{ slug: 'test-plugin', active: true }];
  await service.deactivate('test-plugin');

  expect(service.getAdapter('character-sync', 'test-game')).toBeUndefined();
}

async function testIsActiveAfterInstall() {
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

  let selectCallCount = 0;
  mockDb.select.mockImplementation(() => ({
    from: jest.fn().mockImplementation(() => ({
      where: jest.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return thenableResult([]);
        return thenableResult([{ slug: 'test-plugin' }]);
      }),
    })),
  }));

  await service.install('test-plugin');
  expect(service.isActive('test-plugin')).toBe(true);
}

describe('PluginRegistryService — manifest registration', () => {
  beforeEach(() => setupEach());
  afterEach(() => jest.clearAllMocks());

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

    it('should merge manifests with DB records', () => testListPluginsMerge());

    it('should include author from manifest', async () => {
      service.registerManifest(testManifest);
      mockSelectWithCredentials([], []);
      const result = await service.listPlugins();
      expect(result[0].author).toEqual({ name: 'Test Author' });
    });

    it('should return not_installed for manifests without DB records', async () => {
      service.registerManifest(testManifest);
      mockSelectWithCredentials([], []);
      const result = await service.listPlugins();
      expect(result[0].status).toBe('not_installed');
      expect(result[0].installedAt).toBeNull();
    });

    it('should resolve configured flag for integrations', () =>
      testConfiguredFlag());

    it('should set configured=false when any credential key is missing', () =>
      testConfiguredFalseWhenKeyMissing());
  });
});

describe('PluginRegistryService — install & uninstall', () => {
  beforeEach(() => setupEach());
  afterEach(() => jest.clearAllMocks());

  describe('install()', () => {
    it('should create DB record and emit INSTALLED event', () =>
      testInstallEmitsEvent());

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
});

describe('PluginRegistryService — activate & deactivate', () => {
  beforeEach(() => setupEach());
  afterEach(() => jest.clearAllMocks());

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

    it('should remove adapters for the plugin gameSlugs on deactivation', () =>
      testDeactivateRemovesAdapters());
  });
});

describe('PluginRegistryService — ensureInstalled & isActive', () => {
  beforeEach(() => setupEach());
  afterEach(() => jest.clearAllMocks());

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

    it('should return true after activating a plugin', () =>
      testIsActiveAfterInstall());
  });

  describe('getActiveSlugsSync()', () => {
    it('should return empty set initially', () => {
      expect(service.getActiveSlugsSync().size).toBe(0);
    });
  });
});
