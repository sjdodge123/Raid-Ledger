# Plugin System

Raid Ledger uses a plugin architecture to extend functionality. Plugins are NestJS modules that register themselves with the plugin host and provide capabilities through extension points.

## Architecture

- **Plugin Host** — The core module that manages plugin registration, activation, and lifecycle
- **Plugin Manifest** — Each plugin declares its capabilities, settings, and integrations
- **Extension Points** — Defined interfaces that plugins implement (auth providers, content providers, cron registrars, etc.)
- **Plugin Admin** — Web UI for enabling/disabling plugins and configuring their settings

## Built-in Plugins

### Discord Authentication

**Plugin ID:** `discord`

Provides Discord OAuth2 authentication for login and account linking.

**Capabilities:**
- `auth-provider` — Discord OAuth login flow

**Settings:**
- `discord_client_id` — Discord application Client ID
- `discord_client_secret` — Discord application Client Secret
- `discord_callback_url` — OAuth callback URL

**Configuration:** Set up via **Admin Settings** > **Integrations** > **Discord**.

### World of Warcraft (Blizzard)

**Plugin ID:** `blizzard`

Blizzard API integration for WoW character sync, realm data, and dungeon/raid content.

**Capabilities:**
- `character-sync` — Sync WoW characters from Battle.net
- `content-provider` — Boss encounter data, dungeon quests
- `cron-registrar` — Scheduled data refresh jobs

**Settings:**
- `blizzard_client_id` — Battle.net API Client ID
- `blizzard_client_secret` — Battle.net API Client Secret

**Features:**
- Character sync from Battle.net
- Boss encounter data for raids
- Dungeon quest tracking
- Automatic data refresh via scheduled cron jobs

**Configuration:** Set up via **Admin Settings** > **Integrations** > **Blizzard API**.

## Plugin Lifecycle

1. **Registration** — Plugins register their manifest with the plugin host at startup
2. **Activation** — Admins enable plugins through the admin panel
3. **Configuration** — Plugin-specific settings are configured via integrations
4. **Active Guard** — Plugin routes are protected by the `PluginActiveGuard` — disabled plugins return 404

## Managing Plugins

1. Go to **Admin Settings** > **Plugins**
2. View installed plugins with their status
3. Enable or disable plugins as needed
4. Configure plugin-specific settings via the integrations panel

## Next Steps

- [Discord Bot Setup](Discord-Bot-Setup) — Configure the Discord integration
- [Authentication](Authentication) — Login methods
- [Configuration Reference](Configuration-Reference) — All settings
