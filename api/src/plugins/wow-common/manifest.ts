import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';

export const WOW_COMMON_MANIFEST: PluginManifest = {
  id: 'blizzard',
  name: 'World of Warcraft (Blizzard)',
  version: '1.0.0',
  description:
    'Blizzard API integration for WoW character sync, realm data, and dungeon/raid content.',
  author: { name: 'Raid Ledger' },
  gameSlugs: ['world-of-warcraft', 'world-of-warcraft-classic'],
  capabilities: ['character-sync', 'content-provider', 'cron-registrar'],
  settingKeys: ['blizzard_client_id', 'blizzard_client_secret'],
  integrations: [
    {
      key: 'blizzard-api',
      name: 'Blizzard API',
      description: 'OAuth2 credentials for Battle.net API access.',
      credentialKeys: ['blizzard_client_id', 'blizzard_client_secret'],
      credentialLabels: ['Client ID', 'Client Secret'],
      settingsEvent: 'settings.blizzard.updated',
    },
  ],
};
