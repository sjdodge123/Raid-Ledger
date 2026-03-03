# Discord Bot Setup

Raid Ledger includes a built-in Discord bot that provides slash commands, event announcements, roster embeds, and voice channel activity monitoring.

## Prerequisites

- A running Raid Ledger instance (see [Getting Started](Getting-Started))
- Admin access to a Discord server
- A Discord Developer Application

## Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (e.g., "Raid Ledger")
3. Navigate to **OAuth2** and note the **Client ID** and **Client Secret**
4. Under **OAuth2 > Redirects**, add your callback URL:
   - For local: `http://localhost/api/auth/discord/callback`
   - For production: `https://yourdomain.com/api/auth/discord/callback`

## Step 2: Configure the Bot

1. In the Discord Developer Portal, go to the **Bot** section
2. Click **Reset Token** and copy the bot token
3. Enable these **Privileged Gateway Intents**:
   - **Presence Intent** — Required for voice channel game detection
   - **Server Members Intent** — Required for user lookups
   - **Message Content Intent** — Not required but recommended

## Step 3: Configure in Raid Ledger

1. Log in to Raid Ledger as an admin
2. Go to **Admin Settings** > **Integrations** > **Discord**
3. Enter your **Client ID** and **Client Secret**
4. The bot token is configured via the `DISCORD_BOT_TOKEN` environment variable:

```bash
docker run -d -p 80:80 \
  -e DISCORD_BOT_TOKEN=your-bot-token-here \
  ghcr.io/sjdodge123/raid-ledger:main
```

## Step 4: Invite the Bot to Your Server

Use the OAuth2 URL generator in the Discord Developer Portal, or construct the URL manually:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2147485696&scope=bot%20applications.commands
```

Required permissions:
- **Send Messages** — For event announcements
- **Embed Links** — For rich event embeds
- **Use Application Commands** — For slash commands

## Available Slash Commands

Once the bot is connected, the following slash commands are available:

| Command | Description |
|---------|-------------|
| `/event create` | Quick-create an event from Discord |
| `/event plan` | Start an interactive event-planning wizard |
| `/events` | List upcoming events |
| `/roster` | View the roster for an event |
| `/invite` | Invite a user or generate an invite link |
| `/bind` | Bind a channel to a game or event |
| `/unbind` | Remove a channel binding |
| `/bindings` | List all active channel bindings |
| `/playing` | Manually set your current game |
| `/help` | List all available bot commands |

### `/event create`

Quick-create an event with natural language time parsing:

```
/event create title:"Friday Night Raid" game:"World of Warcraft" time:"Friday 8pm"
```

Options:
- `title` (required) — Event title
- `game` (required) — Game name (autocomplete from IGDB catalog)
- `time` (required) — Natural language time (e.g., "tonight 8pm", "Friday 7:30pm")
- `roster` — Roster type: Generic (headcount) or MMO (Tank/Healer/DPS)
- `slots` — Max attendees (default: 20)
- `tanks` / `healers` / `dps` — Role slot counts (MMO roster only)

### `/event plan`

Opens the web-based event planning form where you can create polls to find the best time for your community.

### `/roster`

View the roster for an event directly in Discord:

```
/roster event:"Friday Night Raid"
```

Shows role breakdown (Tank/Healer/DPS), assigned players, and a link to the full roster in the web app.

### `/invite`

Two modes:
- **Anonymous link:** `/invite event:"Raid Night"` — Generates a shareable invite link
- **Named invite:** `/invite event:"Raid Night" user:@Player` — Sends a DM invite to the specified user

### `/playing`

Manual fallback for users without Discord Rich Presence. Sets a temporary game override (30 minutes) for general lobby channels:

```
/playing game:"World of Warcraft"
```

Run `/playing` without arguments to clear the override.

## Troubleshooting

- **Commands not showing up:** It can take up to an hour for slash commands to propagate. Try restarting the container.
- **Bot not responding:** Check that the `DISCORD_BOT_TOKEN` environment variable is set and the bot is online in your server.
- **Permission errors:** Ensure the bot has the required permissions listed above.

## Next Steps

- [Channel Bindings](Channel-Bindings) — Bind channels to games and events
- [Ad-Hoc Voice Events](Ad-Hoc-Voice-Events) — Automatic voice activity detection
