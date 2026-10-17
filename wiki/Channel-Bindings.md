# Channel Bindings

Channel bindings connect Discord channels to specific games, event series, or events. This enables targeted event announcements and voice channel activity monitoring.

## Binding Types

### Text Channel Bindings

Text channels can be bound for **event announcements**:

- **Game-specific:** Binds a text channel to a specific game. Events for that game are announced in the bound channel.
- **General Lobby:** No game specified. The bot auto-detects games from Discord Rich Presence and routes announcements accordingly.
- **Series:** Binds to a recurring event series (recurrence group). All instances of that series are announced in the channel.

### Voice Channel Bindings

Voice channels are bound for **activity monitoring**:

- **Game-specific:** Monitors a voice channel for players of a specific game. Used by the ad-hoc voice event system.
- **General Lobby:** Monitors any voice activity and auto-detects games via Discord Rich Presence.

## Creating Bindings

### Via Discord Slash Command

```
/bind game:"World of Warcraft"
```

This binds the current channel to WoW. Options:

- `game` — Game name (autocomplete from IGDB catalog)
- `channel` — Target channel (defaults to current)
- `series` — Event series (recurrence group)
- `event` — Specific event (for notification channel override or game reassignment)

**Per-event binding** (overrides the default announcement channel for a specific event):

```
/bind event:"Friday Raid" channel:#raid-chat
```

### Via Web Admin Panel

1. Go to **Admin Settings** > **Integrations** > **Channel Bindings**
2. Click **Add Binding**
3. Select the channel, type, and optional game/series filter

## Removing Bindings

```
/unbind
```

Removes the binding from the current channel. Use the `channel` option to unbind a different channel.

## Listing Bindings

```
/bindings
```

Lists all active channel bindings in the server with their type, game, and behavior.

## Binding Behaviors

| Type | Game | Behavior |
|------|------|----------|
| Text | Specified | `game-announcements` — Events for that game post here |
| Text | None | `general-lobby` — Auto-detect games, route announcements |
| Voice | Specified | `game-voice-monitor` — Monitor for players of that game |
| Voice | None | `game-voice-monitor` — Monitor any voice activity |

## Binding Replacement

When you create a new binding that conflicts with an existing one (same guild + same game/behavior), the old binding is automatically replaced. The bot will notify you which channels were replaced.

## Next Steps

- [Discord Bot Setup](Discord-Bot-Setup) — Full bot configuration
- [Ad-Hoc Voice Events](Ad-Hoc-Voice-Events) — Voice activity monitoring
- [Events and Scheduling](Events-and-Scheduling) — Event creation
