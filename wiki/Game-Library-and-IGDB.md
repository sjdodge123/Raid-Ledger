# Game Library and IGDB

Raid Ledger includes a built-in game catalog powered by IGDB (Internet Game Database) with over 200,000 games.

## Game Catalog

The game catalog is pre-populated with games from IGDB. Each game includes:
- **Name** — Official game title
- **Cover Art** — Game cover image
- **Genres** — Genre classifications for filtering
- **Summary** — Game description

## Browsing Games

### Web App

Navigate to the **Games** page to browse the catalog:
- **Search** — Type to filter by game name
- **Genre Filter** — Filter by genre (RPG, FPS, Strategy, etc.)
- **Game Pages** — Click a game to see its dedicated page with events and players

### Discord

Games are available via autocomplete in slash commands:
- `/event create game:` — Type to search games
- `/bind game:` — Type to search games
- `/playing game:` — Type to search games

## Game Registry

The game registry tracks which games your community actively plays. Games appear in the registry when:
- An event is created for that game
- A channel binding is configured for that game

## Game Time

Each user's profile shows their "Game Time" — a breakdown of which games they've played and how much time they've spent in events for each game.

## IGDB Integration

The IGDB catalog is included in the Docker image. No external API calls are needed for basic game lookups. The catalog includes:
- Game names and IDs
- Cover art URLs
- Genre metadata
- Platform information

## Next Steps

- [Events and Scheduling](Events-and-Scheduling) — Create events for specific games
- [Channel Bindings](Channel-Bindings) — Bind channels to games
- [Analytics and Metrics](Analytics-and-Metrics) — Game popularity metrics
