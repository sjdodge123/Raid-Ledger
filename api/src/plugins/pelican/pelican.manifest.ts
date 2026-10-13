import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import {
  PELICAN_INTEGRATION_KEY,
  PELICAN_PLUGIN_ID,
} from './pelican.constants';

/** The settings a Pelican uninstall removes (and evicts from the cache). */
export const PELICAN_SETTING_KEYS = [
  SETTING_KEYS.PELICAN_PANEL_URL,
  SETTING_KEYS.PELICAN_CLIENT_API_KEY,
  SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE,
] as const;

/**
 * Pelican game-server panel plugin (ROK-121). Registered only — never
 * auto-installed, so an uninstall sticks across restarts (Lead ruling Q1).
 * Capabilities are display strings; S2 registers no adapter or cron yet.
 */
export const PELICAN_MANIFEST: PluginManifest = {
  id: PELICAN_PLUGIN_ID,
  name: 'Pelican Panel',
  version: '1.0.0',
  description:
    'Show game servers from a self-hosted Pelican panel — status and schedules, read-only.',
  author: { name: 'Raid Ledger' },
  gameSlugs: [],
  capabilities: ['game-server-provider', 'cron-registrar'],
  settingKeys: [SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE],
  integrations: [
    {
      key: PELICAN_INTEGRATION_KEY,
      name: 'Pelican Panel',
      description:
        'Connect with a client API key (pacc_) for a read-only panel subuser.',
      credentialKeys: [
        SETTING_KEYS.PELICAN_PANEL_URL,
        SETTING_KEYS.PELICAN_CLIENT_API_KEY,
      ],
      credentialLabels: ['Panel URL', 'Client API key'],
    },
  ],
};
