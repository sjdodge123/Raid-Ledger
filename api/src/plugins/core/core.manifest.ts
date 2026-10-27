import { CORE_PLUGIN_ID, HUB_PLUGIN_MANIFESTS } from '@raid-ledger/contract';
import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';

/**
 * ROK-1969 D2 — the built-in Core plugin: owns the hub widgets, tabs and
 * behaviours every hub can use. Always on (D3): it cannot be deactivated or
 * uninstalled, and `isActive('core')` is true before its row exists.
 */
export const CORE_MANIFEST: PluginManifest = {
  id: CORE_PLUGIN_ID,
  name: 'Core',
  version: '1.0.0',
  description:
    'Built-in hub widgets and behaviours every hub can use. Always on.',
  author: { name: 'Raid Ledger' },
  capabilities: [],
  builtIn: true,
  hub: HUB_PLUGIN_MANIFESTS.core,
};
