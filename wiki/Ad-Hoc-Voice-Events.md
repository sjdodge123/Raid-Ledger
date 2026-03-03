# Ad-Hoc Voice Events

Ad-hoc voice events are spontaneous events that are automatically created when players join voice channels. The system uses Discord Rich Presence to detect what game players are playing and creates temporary events accordingly.

## How It Works

1. **Voice channel monitoring** — The bot monitors voice channels that have a [channel binding](Channel-Bindings)
2. **Game detection** — When a player joins a monitored voice channel, the bot checks their Discord Rich Presence to determine what game they're playing
3. **Event creation** — If enough players are detected playing the same game, an ad-hoc event is automatically created
4. **Live badge** — Ad-hoc events display a "LIVE" badge on the events list and event detail pages
5. **Auto-close** — When all players leave the voice channel, the ad-hoc event is automatically closed

## Setup

### 1. Create a Voice Channel Binding

Bind a voice channel to enable monitoring:

```
/bind channel:#gaming-voice game:"World of Warcraft"
```

Or bind without a game for general lobby behavior (auto-detect any game):

```
/bind channel:#general-voice
```

### 2. Enable Presence Intent

The bot requires the **Presence Intent** to detect games via Discord Rich Presence. See [Discord Bot Setup](Discord-Bot-Setup) for details.

## Manual Game Override

Not everyone uses Discord Rich Presence. Players can manually set their current game:

```
/playing game:"World of Warcraft"
```

The override lasts 30 minutes or until cleared with `/playing` (no arguments).

## General Lobby Channels

When a voice channel is bound without a specific game (general lobby), the bot:
- Monitors all voice activity
- Auto-detects games from Rich Presence
- Groups players by detected game
- Creates separate ad-hoc events per game

## Live Status

Ad-hoc voice events appear with a "LIVE" badge throughout the application:
- Events list page
- Calendar view
- Event detail page
- Discord embed updates

## Next Steps

- [Channel Bindings](Channel-Bindings) — Configure channel bindings
- [Discord Bot Setup](Discord-Bot-Setup) — Bot configuration
- [Events and Scheduling](Events-and-Scheduling) — Standard event creation
