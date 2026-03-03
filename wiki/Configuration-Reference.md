# Configuration Reference

## Environment Variables

These environment variables can be set when running the Docker container.

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `80` | Port to expose the application |
| `ADMIN_PASSWORD` | *(random)* | Set a specific admin password; updates on every startup if set |
| `DEBUG` | `false` | Enable verbose logging (query details, startup diagnostics, plugin internals) |
| `DISABLE_TELEMETRY` | `false` | Set to `true` to disable anonymous error reporting via Sentry |

### Discord

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | — | Discord bot token for slash commands and event announcements |
| `CLIENT_URL` | — | Public URL of the web app (used for magic links in Discord embeds) |
| `CORS_ORIGIN` | — | Allowed CORS origins (fallback for `CLIENT_URL`) |

### Database

The built-in PostgreSQL is configured automatically. These variables are only needed for external database connections:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(internal)* | PostgreSQL connection string |

## Admin Settings

These settings are configured through the web admin panel at **Admin Settings**.

### General

- **Community Name** — Display name for your community
- **Default Timezone** — Timezone used for event display when users haven't set a preference

### Integrations

- **Discord OAuth** — Client ID and Client Secret for Discord login
- **Channel Bindings** — Manage Discord channel-to-game bindings
- **Blizzard API** — Client ID and Secret for WoW character sync (requires the wow-common plugin)

### Site Settings

- **Banner** — Optional announcement banner shown across the site
- **Theme** — Multiple built-in themes including dark gaming themes

## Docker Compose (Development)

For local development with separate services:

```yaml
services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: raid_ledger
    ports:
      - "5432:5432"

  redis:
    image: redis:latest
    ports:
      - "6379:6379"
```

Then run the application:

```bash
npm install
npm run dev
```

## Health Check

The API exposes a health check endpoint:

```
GET /api/health
```

Returns `200 OK` when the application is running and the database is connected.

## Next Steps

- [Getting Started](Getting-Started) — Initial deployment
- [Discord Bot Setup](Discord-Bot-Setup) — Configure the Discord bot
- [Backup and Recovery](Backup-and-Recovery) — Database backup configuration
