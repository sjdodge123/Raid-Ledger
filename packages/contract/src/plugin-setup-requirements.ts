/**
 * ROK-1969 §3.5 — the setup each plugin needs today, as declared on main.
 * Spread into `HUB_PLUGIN_MANIFESTS` (`plugin-hub-manifests.ts`). Names what
 * is needed and where it goes; never a secret value. A `check` id is what the
 * api reports met/unmet for on `PluginInfo.setupStatus`.
 */
import type { PluginSetup } from './plugin-setup.schema.js';

const VALHEIM_MOD_REPO = 'https://github.com/Raid-Ledger-Plugins/rl-valheim-link';
const VALHEIM_MOD_CFG = 'BepInEx/config/RaidLedger.ValheimLink.cfg';

/**
 * ROK-1953 D7 — Core works without either; the shared Steam cards
 * (Achievement race, Playtime) on game hubs need both.
 */
export const CORE_SETUP = {
  requirements: [
    {
      id: 'steam-api-key',
      kind: 'admin_setting',
      title: 'Steam Web API key',
      instructions:
        '1. Get a key at https://steamcommunity.com/dev/apikey.\n2. Enter it in Admin → Integrations → Steam. The Achievement race and Playtime cards on game hubs use it.',
      required: false,
      links: [{ label: 'Steam Web API key page', url: 'https://steamcommunity.com/dev/apikey' }],
      check: 'core.steam_api_key',
    },
    {
      id: 'player-steam-link',
      kind: 'steam_link',
      title: 'Players link Steam',
      instructions:
        "Each player links Steam on their Raid Ledger profile and sets Game Details to Public in Steam's privacy settings. Unlinked players are left off the Achievement race and Playtime cards.",
      required: false,
    },
  ],
} satisfies PluginSetup;

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
        '1. In the Pelican panel, create a client API key (Account → API Keys — a client key, not an application key) on a user that can see your game servers, and set its Allowed IPs to the address of the Raid Ledger server.\n2. In Admin → Integrations → Pelican Panel, enter the panel URL and the key, then choose Test Connection. The key is write-only and never shown again.',
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
        '1. Install LedgerLink from CurseForge or GitHub.\n2. In game, open LedgerLink and copy your guild export.\n3. Paste it under Guilds → Import guild. Roster, ranks and raid schedule come with it. Each player’s character export adds gear, quests and lockouts; a raider’s raid export adds boss kills and wipes.',
      required: false,
      appliesTo: ['wow_guild'],
      links: [{ label: 'LedgerLink on GitHub', url: 'https://github.com/sjdodge123/ledger-link' }],
    },
    {
      // ROK-1964: optional auto-upload; paste keeps working without it.
      id: 'ledgerlink-companion',
      kind: 'companion_app',
      title: 'Raid Ledger Companion (optional auto-upload)',
      instructions:
        '1. Install the Raid Ledger Companion on the PC you play WoW on and link it to your account.\n2. Turn on LedgerLink in the Companion and point it at your World of Warcraft folder.\n3. LedgerLink saves an export when you log out; the Companion uploads it and Raid Ledger applies it. Pasting still works.',
      required: false,
      appliesTo: ['wow_guild'],
    },
  ],
} satisfies PluginSetup;

/**
 * ROK-1957 D-17 — both per hub, so no `check` (setupStatus is plugin-wide).
 * Companion / drag-and-drop links are added when ROK-1960/1961 ship (Q-7:
 * `required: true` stays meanwhile).
 */
export const BG3_SETUP = {
  requirements: [
    {
      id: 'upload-saves',
      kind: 'companion_app',
      title: 'Players upload their BG3 saves',
      instructions:
        'Each player installs the Raid Ledger Companion on the PC they play on, or drags a save file onto the hub. Saves upload as they are made.',
      required: true,
      appliesTo: ['game_community'],
    },
    {
      id: 'bind-campaign',
      kind: 'other',
      title: 'Bind a campaign to the hub',
      instructions:
        "1. A member creates a campaign on the Baldur's Gate 3 hub.\n2. Each player binds their saves to it, or sets it as their default campaign. Saves that are not bound stay private to their uploader.",
      required: true,
      appliesTo: ['game_community'],
    },
    {
      id: 'gallery-saves',
      kind: 'other',
      title: 'Save pictures in the hub Gallery',
      instructions:
        "Nothing to install. About 4 hours after a play session ends, the picture of its last save appears in the hub Gallery under Saves. While the hub's spoiler setting hides location and screenshots, save pictures stay hidden for everyone.",
      required: false,
      appliesTo: ['game_community'],
    },
  ],
} satisfies PluginSetup;
