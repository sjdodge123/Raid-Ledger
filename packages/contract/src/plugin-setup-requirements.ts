/**
 * ROK-1969 §3.5 — the setup each plugin needs today, as declared on main.
 * Spread into `HUB_PLUGIN_MANIFESTS` (`plugin-hub-manifests.ts`). Names what
 * is needed and where it goes; never a secret value. A `check` id is what the
 * api reports met/unmet for on `PluginInfo.setupStatus`.
 */
import type { PluginSetup } from './plugin-setup.schema.js';

const VALHEIM_MOD_REPO = 'https://github.com/Raid-Ledger-Plugins/rl-valheim-link';
const VALHEIM_MOD_CFG = 'BepInEx/config/RaidLedger.ValheimLink.cfg';

/** Core needs nothing. */
export const CORE_SETUP = { requirements: [] } satisfies PluginSetup;

export const VALHEIM_SETUP = {
  requirements: [
    {
      id: 'pelican-server',
      kind: 'pelican_egg',
      title: 'A Valheim server on Pelican, mapped to Valheim',
      instructions:
        '1. Run the server on your Pelican panel from a Valheim egg that loads BepInEx.\n2. Install and connect the Pelican plugin.\n3. In Admin → Integrations → Pelican Panel, map the server to the game Valheim and bind it to a game-server hub.',
      required: true,
      appliesTo: ['game_server'],
      check: 'valheim.server_bound',
      pelican: { eggHint: 'A Valheim egg with BepInEx (mods) enabled' },
    },
    {
      id: 'link-mod',
      kind: 'server_mod',
      title: 'Install the RL Valheim Link mod',
      instructions:
        '1. Download the latest RL Valheim Link release.\n2. Put it in the game server\'s `BepInEx/plugins/` folder.\n3. Restart the server. Characters, the map and the item catalogue start uploading once the token below is set.',
      required: true,
      appliesTo: ['game_server'],
      links: [{ label: 'RL Valheim Link', url: VALHEIM_MOD_REPO }],
      check: 'valheim.mod_heartbeat',
      pelican: { files: ['BepInEx/plugins/'] },
    },
    {
      id: 'link-token',
      kind: 'server_secret',
      title: 'The server\'s mod token',
      instructions:
        `1. In Admin → Integrations → Pelican Panel, choose Generate token on the Valheim server's row. The token is shown once.\n2. Copy the config block it shows (BaseUrl, ServerId, ServerToken) into \`${VALHEIM_MOD_CFG}\` under \`[RaidLedger]\`, then restart the server.\n3. Rotate the token if it leaks; the mod picks up the new one within 10 minutes.`,
      required: true,
      appliesTo: ['game_server'],
      check: 'valheim.link_token_active',
      pelican: { files: [VALHEIM_MOD_CFG] },
    },
    {
      id: 'item-catalogue-admin',
      kind: 'other',
      title: 'A server admin joins after each game update',
      instructions:
        '1. Add a player\'s SteamID64 to the game server\'s `adminlist.txt` (`Steam_7656…`).\n2. After every Valheim update, have that player join once so the mod exports item names and icons.',
      required: false,
      appliesTo: ['game_server'],
    },
    {
      id: 'player-steam-link',
      kind: 'steam_link',
      title: 'Players link Steam',
      instructions:
        'Each player links Steam on their Raid Ledger profile so their Valheim characters are matched to them. Unlinked characters are suggested for claiming instead.',
      required: false,
      appliesTo: ['game_server'],
    },
  ],
} satisfies PluginSetup;

export const PELICAN_SETUP = {
  requirements: [
    {
      id: 'panel-connection',
      kind: 'admin_setting',
      title: 'Connect your Pelican panel',
      instructions:
        '1. In the Pelican panel, create a client API key (Account → API Keys; it starts with `pacc_`) on a user that can see your game servers, and set its Allowed IPs to the address of the Raid Ledger server.\n2. In Admin → Integrations → Pelican Panel, enter the panel URL and the key, then choose Test Connection. The key is write-only and never shown again.',
      required: true,
      check: 'pelican.panel_configured',
    },
    {
      id: 'server-hub',
      kind: 'admin_setting',
      title: 'Bind a server to a hub',
      instructions:
        'After the first sync, open Admin → Integrations → Pelican Panel and bind each server to a game-server hub. Unbound servers stay off every hub.',
      required: true,
      appliesTo: ['game_server'],
      check: 'pelican.server_bound',
    },
  ],
} satisfies PluginSetup;

export const BLIZZARD_SETUP = {
  requirements: [
    {
      id: 'battle-net-api',
      kind: 'admin_setting',
      title: 'Battle.net API client',
      instructions:
        '1. Create a client at the Blizzard developer portal.\n2. Enter its client ID and secret in Admin → Integrations → Blizzard API. Character sync and raid data refresh use it.',
      required: true,
      links: [{ label: 'Blizzard developer portal', url: 'https://develop.battle.net/access/clients' }],
      check: 'blizzard.api_credentials',
    },
    {
      id: 'ledgerlink-addon',
      kind: 'companion_app',
      title: 'LedgerLink addon (players)',
      instructions:
        '1. Install LedgerLink from CurseForge or GitHub.\n2. In game, open LedgerLink and copy your guild export.\n3. Paste it under Guilds → Import guild. Roster, ranks and raid schedule come with it.',
      required: false,
      appliesTo: ['wow_guild'],
      links: [{ label: 'LedgerLink on GitHub', url: 'https://github.com/sjdodge123/ledger-link' }],
    },
  ],
} satisfies PluginSetup;
