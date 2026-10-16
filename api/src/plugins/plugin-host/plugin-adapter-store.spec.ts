import { PluginAdapterStore } from './plugin-adapter-store';

const POINT = 'game-server-provider';
const KEY = '*';

let store: PluginAdapterStore;

beforeEach(() => {
  store = new PluginAdapterStore();
});

describe('PluginAdapterStore — registerMultiAdapter()', () => {
  it('does not duplicate the same instance registered twice', () => {
    const provider = { id: 'a' };
    store.registerMultiAdapter(POINT, KEY, provider);
    const total = store.registerMultiAdapter(POINT, KEY, provider);
    expect(total).toBe(1);
    expect(store.getMultiAdapters(POINT, KEY)).toEqual([provider]);
  });

  it('keeps distinct instances side by side', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    store.registerMultiAdapter(POINT, KEY, a);
    store.registerMultiAdapter(POINT, KEY, b);
    expect(store.getMultiAdapters(POINT, KEY)).toEqual([a, b]);
  });
});

describe('PluginAdapterStore — suspendAdaptersOwnedBy()', () => {
  it('removes owned multi + single adapters and leaves unowned ones', () => {
    const owned = { id: 'owned' };
    const unowned = { id: 'unowned' };
    const ownedSingle = { id: 'owned-single' };
    store.registerMultiAdapter(POINT, KEY, owned, {
      ownerPluginId: 'plug-a',
    });
    store.registerMultiAdapter(POINT, KEY, unowned);
    store.registerAdapter('cron-registrar', 'plug-a', ownedSingle, {
      ownerPluginId: 'plug-a',
    });

    expect(store.suspendAdaptersOwnedBy('plug-a')).toBe(2);

    expect(store.getMultiAdapters(POINT, KEY)).toEqual([unowned]);
    expect(store.getAdapter('cron-registrar', 'plug-a')).toBeUndefined();
  });

  it('leaves adapters owned by another plugin untouched', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    store.registerMultiAdapter(POINT, KEY, a, { ownerPluginId: 'plug-a' });
    store.registerMultiAdapter(POINT, KEY, b, { ownerPluginId: 'plug-b' });

    store.suspendAdaptersOwnedBy('plug-a');

    expect(store.getMultiAdapters(POINT, KEY)).toEqual([b]);
  });

  it('is a no-op for a plugin that owns nothing', () => {
    const unowned = { id: 'unowned' };
    store.registerMultiAdapter(POINT, KEY, unowned);
    expect(store.suspendAdaptersOwnedBy('plug-a')).toBe(0);
    expect(store.getMultiAdapters(POINT, KEY)).toEqual([unowned]);
  });

  it('is idempotent — a second suspend keeps the first suspension', () => {
    const owned = { id: 'owned' };
    store.registerMultiAdapter(POINT, KEY, owned, {
      ownerPluginId: 'plug-a',
    });
    store.suspendAdaptersOwnedBy('plug-a');
    expect(store.suspendAdaptersOwnedBy('plug-a')).toBe(0);

    expect(store.restoreAdaptersOwnedBy('plug-a')).toBe(1);
    expect(store.getMultiAdapters(POINT, KEY)).toEqual([owned]);
  });
});

describe('PluginAdapterStore — restoreAdaptersOwnedBy()', () => {
  it('restores suspended multi + single adapters exactly once', () => {
    const owned = { id: 'owned' };
    const ownedSingle = { id: 'owned-single' };
    store.registerMultiAdapter(POINT, KEY, owned, {
      ownerPluginId: 'plug-a',
    });
    store.registerAdapter('cron-registrar', 'plug-a', ownedSingle, {
      ownerPluginId: 'plug-a',
    });
    store.suspendAdaptersOwnedBy('plug-a');

    store.restoreAdaptersOwnedBy('plug-a');
    // A plugin's own ACTIVATED handler may re-register the same instance.
    store.registerMultiAdapter(POINT, KEY, owned, {
      ownerPluginId: 'plug-a',
    });

    expect(store.getMultiAdapters(POINT, KEY)).toEqual([owned]);
    expect(store.getAdapter('cron-registrar', 'plug-a')).toBe(ownedSingle);
  });

  it('never clobbers a newer single registration on the same key', () => {
    const old = { id: 'old' };
    const newer = { id: 'newer' };
    store.registerAdapter('cron-registrar', 'plug-a', old, {
      ownerPluginId: 'plug-a',
    });
    store.suspendAdaptersOwnedBy('plug-a');
    store.registerAdapter('cron-registrar', 'plug-a', newer);

    store.restoreAdaptersOwnedBy('plug-a');

    expect(store.getAdapter('cron-registrar', 'plug-a')).toBe(newer);
  });

  it('restored adapters can be suspended again', () => {
    const owned = { id: 'owned' };
    store.registerMultiAdapter(POINT, KEY, owned, {
      ownerPluginId: 'plug-a',
    });
    store.suspendAdaptersOwnedBy('plug-a');
    store.restoreAdaptersOwnedBy('plug-a');

    expect(store.suspendAdaptersOwnedBy('plug-a')).toBe(1);
    expect(store.getMultiAdapters(POINT, KEY)).toEqual([]);
  });

  it('returns 0 when nothing is suspended', () => {
    expect(store.restoreAdaptersOwnedBy('plug-a')).toBe(0);
  });
});

describe('PluginAdapterStore — removeByKeys() — legacy game-slug removal', () => {
  it('drops single + multi adapters under the given keys only', () => {
    const wow = { id: 'wow' };
    const ffxiv = { id: 'ffxiv' };
    store.registerAdapter('character-sync', 'wow', wow);
    store.registerMultiAdapter('data-enricher', 'wow', wow);
    store.registerAdapter('character-sync', 'ffxiv', ffxiv);

    store.removeByKeys(['wow']);

    expect(store.getAdapter('character-sync', 'wow')).toBeUndefined();
    expect(store.getMultiAdapters('data-enricher', 'wow')).toEqual([]);
    expect(store.getAdapter('character-sync', 'ffxiv')).toBe(ffxiv);
  });
});

describe('PluginAdapterStore — findSuspendedOwner() (ROK-1819)', () => {
  const PARSER = 'game-log-parser';

  it('names the owner of an adapter suspended because its plugin is inactive', () => {
    const inactiveStore = new PluginAdapterStore((id) => id !== 'valheim');
    inactiveStore.registerAdapter(
      PARSER,
      'valheim',
      { id: 'parser' },
      {
        ownerPluginId: 'valheim',
      },
    );
    expect(inactiveStore.getAdapter(PARSER, 'valheim')).toBeUndefined();
    expect(inactiveStore.findSuspendedOwner(PARSER, 'valheim')).toBe('valheim');
  });

  it('returns undefined when no adapter was ever registered for the key', () => {
    store.registerAdapter(PARSER, 'valheim', { id: 'parser' });
    expect(store.findSuspendedOwner(PARSER, 'minecraft')).toBeUndefined();
    expect(store.findSuspendedOwner('cron-registrar', 'valheim')).toBe(
      undefined,
    );
  });

  it('returns undefined while the owner is active, and again once restored', () => {
    const parser = { id: 'parser' };
    store.registerAdapter(PARSER, 'valheim', parser, {
      ownerPluginId: 'valheim',
    });
    expect(store.findSuspendedOwner(PARSER, 'valheim')).toBeUndefined();

    store.suspendAdaptersOwnedBy('valheim');
    expect(store.findSuspendedOwner(PARSER, 'valheim')).toBe('valheim');

    store.restoreAdaptersOwnedBy('valheim');
    expect(store.getAdapter(PARSER, 'valheim')).toBe(parser);
    expect(store.findSuspendedOwner(PARSER, 'valheim')).toBeUndefined();
  });

  it('ignores a suspended multi adapter under the same point/key', () => {
    store.registerMultiAdapter(
      PARSER,
      'valheim',
      { id: 'multi' },
      {
        ownerPluginId: 'valheim',
      },
    );
    store.suspendAdaptersOwnedBy('valheim');
    expect(store.findSuspendedOwner(PARSER, 'valheim')).toBeUndefined();
  });
});
