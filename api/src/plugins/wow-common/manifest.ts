import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';

/** All WoW game slugs this plugin handles (retail + all classic variants). */
export const ALL_WOW_GAME_SLUGS: string[] = [
  'world-of-warcraft',
  'world-of-warcraft-classic',
  'world-of-warcraft-burning-crusade-classic-anniversary-edition',
  'world-of-warcraft-burning-crusade-classic',
  'world-of-warcraft-wrath-of-the-lich-king',
];

export const WOW_COMMON_MANIFEST: PluginManifest = {
  id: 'blizzard',
  name: 'World of Warcraft (Blizzard)',
  version: '1.0.0',
  description:
    'Blizzard API integration for WoW character sync, realm data, and dungeon/raid content.',
  author: { name: 'Raid Ledger' },
  gameSlugs: ALL_WOW_GAME_SLUGS,
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
