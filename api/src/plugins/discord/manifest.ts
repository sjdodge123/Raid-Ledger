import type { PluginManifest } from '../plugin-host/plugin-manifest.interface';

export const DISCORD_MANIFEST: PluginManifest = {
  id: 'discord',
  name: 'Discord Authentication',
  version: '1.0.0',
  description:
    'Discord OAuth2 authentication provider for login and account linking.',
  author: { name: 'Raid Ledger' },
  capabilities: ['auth-provider'],
  settingKeys: [
    'discord_client_id',
    'discord_client_secret',
    'discord_callback_url',
  ],
  integrations: [
    {
      key: 'discord-oauth',
      name: 'Discord OAuth',
      description: 'OAuth2 credentials for Discord login.',
      credentialKeys: ['discord_client_id', 'discord_client_secret'],
      credentialLabels: ['Client ID', 'Client Secret'],
      settingsEvent: 'settings.oauth.discord.updated',
    },
  ],
};
