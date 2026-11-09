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
  WOW_FOREVER_QUEST_IMPORT_KEY,
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

  it('reports the forever default when nothing is stored (ROK-2102)', async () => {
    const { service } = setup();
    await expect(service.getConfig()).resolves.toEqual({
      namespacePrefix: 'forever',
      namespacePrefixIsDefault: true,
      armoryImportEnabled: true,
      wowheadResolverEnabled: true,
      questImportEnabled: true,
    });
    // ROK-1722: Armory import is on by default (absent key = enabled).
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: true },
    });
  });
});

describe('ForeverConfigService writes (ROK-1717)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it('persists an override + the Armory kill switch and emits the change (ROK-1722)', async () => {
    const { service, store, events } = setup();
    const res = await service.updateConfig({
      namespacePrefix: 'foo',
      armoryImportEnabled: false,
    });
    expect(store.get(WOW_FOREVER_NAMESPACE_PREFIX_KEY)).toBe('foo');
    expect(store.get(WOW_FOREVER_ARMORY_IMPORT_KEY)).toBe('false');
    expect(res).toEqual({
      namespacePrefix: 'foo',
      namespacePrefixIsDefault: false,
      armoryImportEnabled: false,
      wowheadResolverEnabled: true,
      questImportEnabled: true,
    });
    expect(events.emit).toHaveBeenCalledWith(WOW_FOREVER_CONFIG_UPDATED, {
      namespacePrefix: 'foo',
    });
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: false },
    });
  });

  it('deletes both keys when saved back to the defaults (import on)', async () => {
    const { service, store } = setup({
      [WOW_FOREVER_NAMESPACE_PREFIX_KEY]: 'foo',
      [WOW_FOREVER_ARMORY_IMPORT_KEY]: 'false',
    });
    const res = await service.updateConfig({
      namespacePrefix: 'classicforever',
      armoryImportEnabled: true,
    });
    expect([...store.keys()]).toEqual([]);
    expect(res.armoryImportEnabled).toBe(true);
  });

  it.each([
    ['false', false],
    ['true', true],
  ])('reads a stored flag of "%s" as wow_forever=%s', async (stored, on) => {
    const { service } = setup({ [WOW_FOREVER_ARMORY_IMPORT_KEY]: stored });
    await expect(service.getCapabilities()).resolves.toEqual({
      armoryImport: { wow_forever: on },
    });
    await expect(service.getConfig()).resolves.toMatchObject({
      armoryImportEnabled: on,
    });
  });

  it('Wowhead resolver switch: off stores "false", on deletes it, omitted leaves it (ROK-1727 D2)', async () => {
    const { service, store } = setup();
    const base = {
      namespacePrefix: 'classicforever',
      armoryImportEnabled: true,
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

  it('quest import switch: off stores "false", on deletes it, omitted leaves it; each save emits the change (ROK-2143)', async () => {
    const { service, store, events } = setup();
    const base = { namespacePrefix: 'forever', armoryImportEnabled: true };
    const off = await service.updateConfig({
      ...base,
      questImportEnabled: false,
    });
    expect(off.questImportEnabled).toBe(false);
    expect(store.get(WOW_FOREVER_QUEST_IMPORT_KEY)).toBe('false');
    expect(events.emit).toHaveBeenCalledWith(WOW_FOREVER_CONFIG_UPDATED, {
      namespacePrefix: 'forever',
    });
    await service.updateConfig(base);
    expect(store.get(WOW_FOREVER_QUEST_IMPORT_KEY)).toBe('false');
    const on = await service.updateConfig({
      ...base,
      questImportEnabled: true,
    });
    expect(on.questImportEnabled).toBe(true);
    expect(store.has(WOW_FOREVER_QUEST_IMPORT_KEY)).toBe(false);
    expect(events.emit).toHaveBeenCalledTimes(3);
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
    expect(blizzard.purgeNamespace.mock.calls).toEqual([['forever'], ['foo']]);
  });
});

describe('ForeverConfigService default prefix (ROK-2102)', () => {
  afterEach(() => setForeverNamespacePrefix(null));

  it.each(['forever', 'classicforever'])(
    'deletes both keys when saved back to the defaults with %p (ROK-2102)',
    async (namespacePrefix) => {
      const { service, store, events } = setup({
        [WOW_FOREVER_NAMESPACE_PREFIX_KEY]: 'foo',
        [WOW_FOREVER_ARMORY_IMPORT_KEY]: 'false',
      });
      // ROK-1722: the Armory default is ON, so "back to the defaults" = enabled.
      const res = await service.updateConfig({
        namespacePrefix,
        armoryImportEnabled: true,
      });
      expect([...store.keys()]).toEqual([]);
      expect(res.namespacePrefix).toBe('forever');
      expect(res.namespacePrefixIsDefault).toBe(true);
      expect(events.emit).toHaveBeenCalledWith(WOW_FOREVER_CONFIG_UPDATED, {
        namespacePrefix,
      });
    },
  );

  it('an alias save moves the resolver back to forever', () => {
    const { service } = setup();
    setForeverNamespacePrefix('foo');
    service.handleConfigUpdated({ namespacePrefix: 'classicforever' });
    expect(getForeverNamespacePrefix()).toBe('forever');
  });
});
