/** ROK-2067 D2 — `PluginStateCache`: active / inactive / not_installed. */
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { PluginStateCache } from './plugin-state.cache';

describe('PluginStateCache', () => {
  it('maps a row to active / inactive and a missing row to not_installed', () => {
    const cache = new PluginStateCache();
    cache.replace([
      { slug: 'bg3', active: true },
      { slug: 'valheim', active: false },
    ]);
    expect([...cache.active].sort()).toEqual(['bg3', CORE_PLUGIN_ID].sort());
    expect({
      bg3: cache.stateOf('bg3', cache.active.has('bg3')),
      valheim: cache.stateOf('valheim', false),
      pelican: cache.stateOf('pelican', false),
    }).toEqual({
      bg3: 'active',
      valheim: 'inactive',
      pelican: 'not_installed',
    });
  });

  it('a refresh after uninstall drops the slug to not_installed', () => {
    const cache = new PluginStateCache();
    cache.replace([{ slug: 'bg3', active: false }]);
    expect(cache.stateOf('bg3', false)).toBe('inactive');
    cache.replace([]);
    expect(cache.stateOf('bg3', false)).toBe('not_installed');
  });

  it('isActive wins (built-in / always-active plugins with no row)', () => {
    const cache = new PluginStateCache();
    cache.replace([]);
    expect(cache.stateOf('core', true)).toBe('active');
    expect(cache.active.has(CORE_PLUGIN_ID)).toBe(true);
  });
});
