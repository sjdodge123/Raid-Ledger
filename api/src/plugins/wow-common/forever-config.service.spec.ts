import { BadRequestException } from '@nestjs/common';
import { ForeverConfigService } from './forever-config.service';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';
import {
  WOW_FOREVER_ARMORY_IMPORT_KEY,
  WOW_FOREVER_CONFIG_UPDATED,
  WOW_FOREVER_NAMESPACE_PREFIX_KEY,
} from './forever.settings';

/** SettingsService stand-in backed by a Map (get/set/delete only). */
function setup(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
  const blizzard = { purgeNamespace: jest.fn() };
  const events = { emit: jest.fn() };
  const service = new ForeverConfigService(
    settings as never,
    blizzard as never,
    events as never,
  );
  return { service, store, settings, blizzard, events };
}

describe('ForeverConfigService reads (ROK-1717)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it('loads the stored prefix into the resolver on boot', async () => {
    const { service } = setup({ [WOW_FOREVER_NAMESPACE_PREFIX_KEY]: 'foo' });
    await service.onModuleInit();
    expect(getForeverNamespacePrefix()).toBe('foo');
  });

  it('reports the defaults when nothing is stored', async () => {
    const { service } = setup();
    await expect(service.getConfig()).resolves.toEqual({
      namespacePrefix: 'classicforever',
      namespacePrefixIsDefault: true,
      armoryImportEnabled: false,
      wowheadResolverEnabled: true,
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: false },
    });
  });
});

describe('ForeverConfigService writes (ROK-1717)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it('persists an override + the Armory flag and emits the change', async () => {
    const { service, store, events } = setup();
    const res = await service.updateConfig({
      namespacePrefix: 'foo',
      armoryImportEnabled: true,
    });
    expect(store.get(WOW_FOREVER_NAMESPACE_PREFIX_KEY)).toBe('foo');
    expect(store.get(WOW_FOREVER_ARMORY_IMPORT_KEY)).toBe('true');
    expect(res).toEqual({
      namespacePrefix: 'foo',
      namespacePrefixIsDefault: false,
      armoryImportEnabled: true,
      wowheadResolverEnabled: true,
    });
    expect(events.emit).toHaveBeenCalledWith(WOW_FOREVER_CONFIG_UPDATED, {
      namespacePrefix: 'foo',
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: true },
    });
  });

  it('deletes both keys when saved back to the defaults', async () => {
    const { service, store } = setup({
      [WOW_FOREVER_NAMESPACE_PREFIX_KEY]: 'foo',
      [WOW_FOREVER_ARMORY_IMPORT_KEY]: 'true',
    });
    await service.updateConfig({
      namespacePrefix: 'classicforever',
      armoryImportEnabled: false,
    });
    expect([...store.keys()]).toEqual([]);
  });

  it('treats any stored flag value other than "true" as disabled', async () => {
    const { service } = setup({ [WOW_FOREVER_ARMORY_IMPORT_KEY]: 'false' });
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: false },
    });
  });

  it('Wowhead resolver switch: off stores "false", on deletes it, omitted leaves it (ROK-1727 D2)', async () => {
    const { service, store } = setup();
    const base = {
      namespacePrefix: 'classicforever',
      armoryImportEnabled: false,
    };
    const off = await service.updateConfig({
      ...base,
      wowheadResolverEnabled: false,
    });
    expect(off.wowheadResolverEnabled).toBe(false);
    expect(store.get('wowhead_resolver_enabled')).toBe('false');
    await service.updateConfig(base);
    expect(store.get('wowhead_resolver_enabled')).toBe('false');
    const on = await service.updateConfig({
      ...base,
      wowheadResolverEnabled: true,
    });
    expect(on.wowheadResolverEnabled).toBe(true);
    expect(store.has('wowhead_resolver_enabled')).toBe(false);
  });

  it('rejects an invalid prefix with 400 and writes nothing', async () => {
    const { service, settings, events } = setup();
    await expect(
      service.updateConfig({
        namespacePrefix: 'profile-x-us&',
        armoryImportEnabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.set).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('on change: moves the resolver and purges the old and new prefix', () => {
    const { service, blizzard } = setup();
    service.handleConfigUpdated({ namespacePrefix: 'foo' });
    expect(getForeverNamespacePrefix()).toBe('foo');
    expect(blizzard.purgeNamespace.mock.calls).toEqual([
      ['classicforever'],
      ['foo'],
    ]);
  });
});
