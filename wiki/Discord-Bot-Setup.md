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
3. Enable **all three Privileged Gateway Intents**:
   - **Presence Intent** — Required for voice channel game detection (Rich Presence)
   - **Server Members Intent** — Required for user lookups and roster sync
   - **Message Content Intent** — Required for command parsing and event embeds

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

Use the OAuth2 URL generator in the Discord Developer Portal with the permissions listed below, or construct the URL manually using a [permissions calculator](https://discordapi.com/permissions.html).

### Required Bot Permissions

| Permission | Reason |
|------------|--------|
| **Manage Roles** | Assign roles based on event participation |
| **Manage Channels** | Create and configure event channels |
| **Create Instant Invite** | Generate invite links for events |
| **View Channels** | Read channel lists and voice states |
| **Send Messages** | Post event announcements and embeds |
| **Embed Links** | Rich event embeds with signup buttons |
| **Read Message History** | Context for command responses |
| **Send Polls** | Event planning time-slot polls |
| **Manage Guild Expressions** | Manage custom emoji for events |
| **Create Guild Expressions** | Create custom emoji for events |
| **Manage Events** | Manage Discord scheduled events |
| **Create Events** | Create Discord scheduled events |
| **Connect** | Join voice channels for activity monitoring |

### Required Gateway Intents

All eight intents below must be enabled. The three marked **Privileged** must also be toggled on in the Discord Developer Portal under **Bot > Privileged Gateway Intents**.

| Intent | Privileged | Reason |
|--------|-----------|--------|
| Guilds | No | Server and channel structure |
| Guild Messages | No | Command responses in channels |
| Guild Members | **Yes** | User lookups and roster sync |
| Guild Voice States | No | Voice channel activity monitoring |
| Guild Presences | **Yes** | Rich Presence game detection |
| Guild Scheduled Events | No | Discord scheduled event sync |
| Direct Messages | No | DM reminders and no-show notifications |
| Message Content | **Yes** | Command parsing and event embeds |

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

### `/bind`

Bind a Discord channel to a game or event series for automatic announcements and voice monitoring:

```
/bind game:"World of Warcraft" channel:#wow-raids
```

Options:
- `game` — Game name (autocomplete from IGDB catalog)
- `channel` — Target channel (defaults to current channel); supports text and voice channels
- `series` — Bind to an entire recurrence group instead of a single game
- `event` — Override the notification channel or game for a specific event

When used with the `event` option, `/bind` lets the event creator (or an admin/operator) reassign an event to a different channel or game.

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
