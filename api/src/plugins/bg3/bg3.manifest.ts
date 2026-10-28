import { HUB_PLUGIN_MANIFESTS } from '@raid-ledger/contract';
import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';
import { BG3_PLUGIN_ID } from './bg3.constants';

/**
 * Baldur's Gate 3 plugin (ROK-1957 D-1). Registered only — never
 * auto-installed, like Valheim — so prod stays off until an admin installs
 * it (D-13). It owns the `bg3-save` companion contract handler and the
 * save-history retention job.
 */
export const BG3_MANIFEST: PluginManifest = {
  id: BG3_PLUGIN_ID,
  name: "Baldur's Gate 3",
  version: '1.0.0',
  description:
    "Baldur's Gate 3 campaigns — party snapshots and session history from the saves players upload.",
  author: { name: 'Raid Ledger' },
  // ROK-1969: the hub declaration owns the game list.
  gameSlugs: HUB_PLUGIN_MANIFESTS.bg3.gameSlugs,
  capabilities: [],
  settingKeys: [],
  dependencies: [],
  hub: HUB_PLUGIN_MANIFESTS.bg3,
};
