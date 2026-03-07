import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

const noGameManifest: PluginManifest = {
  id: 'no-game-plugin',
  name: 'Non-Game Plugin',
  version: '1.0.0',
  description: 'A plugin without gameSlugs',
  author: { name: 'Test Author' },
  capabilities: ['auth-provider'],
};

let service: PluginRegistryService;
let mockDb: Record<string, jest.Mock>;
let mockEventEmitter: { emit: jest.Mock };

let selectResults: unknown[];
let insertReturning: unknown[];
let deleteWhereFn: jest.Mock;
let updateSetFn: jest.Mock;

async function setupAdaptersEach() {
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
}

describe('PluginRegistryService — registerAdapter', () => {
  beforeEach(() => setupAdaptersEach());
  afterEach(() => jest.clearAllMocks());

  describe('registerAdapter()', () => {
    it('should store and retrieve an adapter by extension point and game slug', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);

      const result = service.getAdapter('character-sync', 'world-of-warcraft');
      expect(result).toBe(adapter);
    });

    it('should return undefined for unregistered adapter', () => {
      expect(
        service.getAdapter('character-sync', 'world-of-warcraft'),
      ).toBeUndefined();
    });

    it('should allow multiple game slugs for same extension point', () => {
      const adapter = { fetchProfile: jest.fn() };
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
      service.registerAdapter(
        'character-sync',
        'world-of-warcraft-classic',
        adapter,
      );

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(
        adapter,
      );
      expect(
        service.getAdapter('character-sync', 'world-of-warcraft-classic'),
      ).toBe(adapter);
    });

    it('should allow different adapters for different extension points', () => {
      const syncAdapter = { fetchProfile: jest.fn() };
      const contentAdapter = { fetchRealms: jest.fn() };

      service.registerAdapter(
        'character-sync',
        'world-of-warcraft',
        syncAdapter,
      );
      service.registerAdapter(
        'content-provider',
        'world-of-warcraft',
        contentAdapter,
      );

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(
        syncAdapter,
      );
      expect(service.getAdapter('content-provider', 'world-of-warcraft')).toBe(
        contentAdapter,
      );
    });

    it('should overwrite existing adapter for same extension point and slug', () => {
      const adapter1 = { fetchProfile: jest.fn() };
      const adapter2 = { fetchProfile: jest.fn() };

      service.registerAdapter('character-sync', 'world-of-warcraft', adapter1);
      service.registerAdapter('character-sync', 'world-of-warcraft', adapter2);

      expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(
        adapter2,
      );
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
      service.registerAdapter(
        'character-sync',
        'world-of-warcraft-classic',
        adapter,
      );

      const result = service.getAdaptersForExtensionPoint('character-sync');
      expect(result.size).toBe(2);
      expect(result.get('world-of-warcraft')).toBe(adapter);
      expect(result.get('world-of-warcraft-classic')).toBe(adapter);
    });
  });
});

describe('PluginRegistryService — removeAdaptersForPlugin', () => {
  beforeEach(() => setupAdaptersEach());
  afterEach(() => jest.clearAllMocks());

  it('should remove adapters for specified game slugs', () => {
    const adapter = { fetchProfile: jest.fn() };
    service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
    service.registerAdapter(
      'character-sync',
      'world-of-warcraft-classic',
      adapter,
    );
    service.registerAdapter('content-provider', 'world-of-warcraft', adapter);
    service.removeAdaptersForPlugin([
      'world-of-warcraft',
      'world-of-warcraft-classic',
    ]);
    expect(
      service.getAdapter('character-sync', 'world-of-warcraft'),
    ).toBeUndefined();
    expect(
      service.getAdapter('character-sync', 'world-of-warcraft-classic'),
    ).toBeUndefined();
    expect(
      service.getAdapter('content-provider', 'world-of-warcraft'),
    ).toBeUndefined();
  });

  it('should not affect adapters for other game slugs', () => {
    const adapter = { fetchProfile: jest.fn() };
    service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
    service.registerAdapter(
      'character-sync',
      'final-fantasy-xiv-online',
      adapter,
    );
    service.removeAdaptersForPlugin(['world-of-warcraft']);
    expect(
      service.getAdapter('character-sync', 'world-of-warcraft'),
    ).toBeUndefined();
    expect(
      service.getAdapter('character-sync', 'final-fantasy-xiv-online'),
    ).toBe(adapter);
  });

  it('should handle undefined gameSlugs gracefully', () => {
    const adapter = { fetchProfile: jest.fn() };
    service.registerAdapter('character-sync', 'world-of-warcraft', adapter);
    service.removeAdaptersForPlugin();
    expect(service.getAdapter('character-sync', 'world-of-warcraft')).toBe(
      adapter,
    );
  });
});

function makeFailDb() {
  const pgError = new Error('relation "plugins" does not exist') as Error & {
    code: string;
  };
  pgError.code = '42P01';
  return {
    ...mockDb,
    select: jest.fn().mockImplementation(() => ({
      from: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockRejectedValue(pgError),
      })),
    })),
  };
}

async function buildFailService() {
  const failModule: TestingModule = await Test.createTestingModule({
    providers: [
      PluginRegistryService,
      { provide: DrizzleAsyncProvider, useValue: makeFailDb() },
      { provide: EventEmitter2, useValue: mockEventEmitter },
    ],
  }).compile();
  return failModule.get<PluginRegistryService>(PluginRegistryService);
}

async function testEmptyActiveSlugsOnMissingTable() {
  const failService = await buildFailService();
  expect(failService.isActive('anything')).toBe(false);
  expect(failService.getActiveSlugsSync().size).toBe(0);
}

async function testLogWarningOnMissingTable() {
  const failService = await buildFailService();
  const loggerWarnSpy = jest
    .spyOn(failService['logger'], 'warn')
    .mockImplementation(() => undefined);
  await failService.onModuleInit();
  expect(loggerWarnSpy).toHaveBeenCalledWith(
    'plugins table not found — plugin system disabled until migration is applied',
  );
}

describe('PluginRegistryService — refreshActiveCache (ROK-363) table missing', () => {
  beforeEach(() => setupAdaptersEach());
  afterEach(() => jest.clearAllMocks());

  it('should start with empty activeSlugs when plugins table does not exist', () =>
    testEmptyActiveSlugsOnMissingTable());

  it('should re-throw non-table-missing database errors', async () => {
    const otherError = new Error('connection refused') as Error & {
      code: string;
    };
    otherError.code = '08006';
    mockDb.select.mockImplementation(() => ({
      from: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockRejectedValue(otherError),
      })),
    }));
    await expect(service.onModuleInit()).rejects.toThrow('connection refused');
  });

  it('should log the expected warning message when plugins table is missing', () =>
    testLogWarningOnMissingTable());
});

describe('PluginRegistryService — refreshActiveCache (ROK-363) error handling', () => {
  beforeEach(() => setupAdaptersEach());
  afterEach(() => jest.clearAllMocks());

  it('should re-throw a plain Error that has no code property', async () => {
    const plainError = new Error('unexpected query error');
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

describe('PluginRegistryService — multiAdapter & noGameSlugs', () => {
  beforeEach(() => setupAdaptersEach());
  afterEach(() => jest.clearAllMocks());

  describe('registerMultiAdapter()', () => {
    it('should store multiple adapters for same extension point and game slug', () => {
      const enricherA = { key: 'raider-io', enrichCharacter: jest.fn() };
      const enricherB = { key: 'warcraftlogs', enrichCharacter: jest.fn() };
      service.registerMultiAdapter(
        'data-enricher',
        'world-of-warcraft',
        enricherA,
      );
      service.registerMultiAdapter(
        'data-enricher',
        'world-of-warcraft',
        enricherB,
      );
      const result = service.getMultiAdapters(
        'data-enricher',
        'world-of-warcraft',
      );
      expect(result).toHaveLength(2);
      expect(result).toContain(enricherA);
      expect(result).toContain(enricherB);
    });

    it('should return empty array for unregistered extension point', () => {
      const result = service.getMultiAdapters('data-enricher', 'nonexistent');
      expect(result).toEqual([]);
    });

    it('should keep adapters separate per game slug', () => {
      const enricherWow = { key: 'raider-io' };
      const enricherFfxiv = { key: 'fflogs' };
      service.registerMultiAdapter(
        'data-enricher',
        'world-of-warcraft',
        enricherWow,
      );
      service.registerMultiAdapter(
        'data-enricher',
        'final-fantasy-xiv',
        enricherFfxiv,
      );
      expect(
        service.getMultiAdapters('data-enricher', 'world-of-warcraft'),
      ).toEqual([enricherWow]);
      expect(
        service.getMultiAdapters('data-enricher', 'final-fantasy-xiv'),
      ).toEqual([enricherFfxiv]);
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
