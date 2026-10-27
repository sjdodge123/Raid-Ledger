/**
 * ROK-1969 C4 — `builtIn` and `hub` are additive: an older api payload
 * without them still parses, with safe defaults.
 */
import { describe, expect, it } from 'vitest';
import { PluginInfoSchema } from '../plugins.schema.js';
import { HUB_PLUGIN_MANIFESTS } from '../plugin-hub-manifests.js';

const legacy = {
  slug: 'valheim',
  name: 'Valheim',
  version: '1.0.0',
  description: 'Valheim support',
  author: { name: 'Raid Ledger' },
  capabilities: ['game-log-parser'],
  integrations: [],
  status: 'active',
  installedAt: null,
};

describe('PluginInfoSchema hub fields (C4)', () => {
  it('defaults builtIn to false and hub to empty lists', () => {
    const parsed = PluginInfoSchema.parse(legacy);
    expect(parsed.builtIn).toBe(false);
    expect(parsed.hub).toEqual({
      widgets: [], tabs: [], behaviours: [], setup: { requirements: [] },
    });
  });

  it('round-trips a built-in plugin with its hub declaration', () => {
    const core = { ...legacy, slug: 'core', builtIn: true, hub: HUB_PLUGIN_MANIFESTS.core };
    const parsed = PluginInfoSchema.parse(core);
    expect(parsed.builtIn).toBe(true);
    expect(parsed.hub.widgets.map((w) => w.id)).toContain('gallery');
  });

  it('fills layoutKey when an api sends a widget without it', () => {
    const hub = {
      widgets: [{ id: 'deaths', title: 'Deaths' }],
      setup: { requirements: [] },
    };
    const parsed = PluginInfoSchema.parse({ ...legacy, hub });
    expect(parsed.hub.widgets[0]?.layoutKey).toBe('plugin');
  });
});
