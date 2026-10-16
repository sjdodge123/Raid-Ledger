import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';
import { PELICAN_PLUGIN_ID } from '../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from './valheim.constants';

/**
 * Valheim game plugin (ROK-1799 V0 / ROK-1800). Registered only — never
 * auto-installed, like Pelican. It owns Valheim's console-line parser,
 * registered as the `game-log-parser` adapter for its game slug; the Pelican
 * plugin hosts the console stream, so it is an install-time dependency.
 */
export const VALHEIM_MANIFEST: PluginManifest = {
  id: VALHEIM_PLUGIN_ID,
  name: 'Valheim',
  version: '1.0.0',
  description:
    'Valheim server presence — reads who is on a Pelican-hosted Valheim server for Quick Play.',
  author: { name: 'Raid Ledger' },
  gameSlugs: [VALHEIM_GAME_SLUG],
  capabilities: ['game-log-parser'],
  settingKeys: [],
  dependencies: [PELICAN_PLUGIN_ID],
};
