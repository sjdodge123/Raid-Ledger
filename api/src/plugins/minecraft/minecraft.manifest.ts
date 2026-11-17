import { HUB_PLUGIN_MANIFESTS } from '@raid-ledger/contract';
import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';
import { PELICAN_PLUGIN_ID } from '../pelican/pelican.constants';
import { MINECRAFT_PLUGIN_ID } from './minecraft.constants';

/**
 * Minecraft game plugin (ROK-2234, PLAN-minecraft-hub §3). Registered only —
 * never auto-installed, like Valheim. One plugin owns both editions; a hub's
 * edition is its bound Pelican server's game. Pelican hosts the servers, so it
 * is an install-time dependency.
 */
export const MINECRAFT_MANIFEST: PluginManifest = {
  id: MINECRAFT_PLUGIN_ID,
  name: 'Minecraft',
  version: '1.0.0',
  description:
    'Minecraft servers on Pelican — Java and Bedrock Edition game-server hubs.',
  author: { name: 'Raid Ledger' },
  // ROK-1969: the hub declaration owns the game list.
  gameSlugs: HUB_PLUGIN_MANIFESTS.minecraft.gameSlugs,
  capabilities: [],
  settingKeys: [],
  dependencies: [PELICAN_PLUGIN_ID],
  hub: HUB_PLUGIN_MANIFESTS.minecraft,
};
