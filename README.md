# Raid Ledger

[![Website](https://img.shields.io/badge/live%20site-GitHub%20Pages-6d28d9)](https://sjdodge123.github.io/Raid-Ledger/)
[![Documentation](https://img.shields.io/badge/docs-wiki-blue)](https://github.com/sjdodge123/Raid-Ledger/wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Run your entire raid operation from inside Discord.** Raid Ledger is a self-hosted, Discord-native dashboard for gaming communities — members sign in with Discord, RSVP to bot-posted event embeds, get DM reminders, and drop into voice channels that spin up automatically per event. Scheduling, signups, attendance, and "what are we playing tonight?" all run themselves.

Built for raid leaders, clan officers, and server owners who are tired of herding players across pinned messages, reaction polls, and attendance spreadsheets.

> 🌐 **[See it in action → sjdodge123.github.io/Raid-Ledger](https://sjdodge123.github.io/Raid-Ledger/)** — screenshots, feature tour, and quick start.

---

## Why Raid Ledger?

- **Discord-native, end to end** — Discord OAuth login (no new passwords), a companion bot with slash commands (`/event create`, `/events`, `/roster`, `/playing`, `/bind`), interactive RSVP embeds, and DM reminders. Your community never leaves Discord.
- **Attendance tracks itself** — who actually shows up in voice *is* the attendance record. Two-phase no-show detection nudges absent players and flags them to the host. No roll-call, no spreadsheet.
- **End the "what are we playing?" deadlock** — community lineups with Common Ground scoring, scheduling polls with availability heatmaps, and AI-assisted game suggestions turn debate into a decision.
- **Schedules that adapt to real life** — recurring events, batched/de-duplicated reminders, running-late flags, and one-tap host delays (+15 / +30 min) that shift the start without resetting confirmations.
- **You own your data** — self-host the whole stack (app + Postgres + Redis) in a single Docker container with automatic nightly backups. No SaaS, no lock-in.

## Features

- **Event scheduling & recurring raids** — one-off or weekly/biweekly/monthly events, reusable templates, and a shared calendar.
- **Discord-native signups & roster management** — auto-allocation, bench slots, MMO-style roles, and tentative→confirmed promotion keep rosters filled without manual juggling.
- **Automated voice attendance** — tracked from real voice presence, with two-phase no-show detection (5-min player nudge, 15-min host report).
- **Ephemeral voice channels** — a dedicated voice room is created per event and reaped on completion, so your server stays tidy.
- **Running-late & host-delay controls** — attendees flag they're late; hosts bump the start by 15/30 minutes in one tap.
- **Smart reminders & reschedule flows** — batched DM reminders and one-tap confirm/decline reschedule prompts.
- **Community lineups & AI game suggestions** — nominate, vote, and let Common Ground scoring surface what everyone actually wants to play.
- **Scheduling polls & availability heatmaps** — find the slot that works for the most people, with deadlines and tiebreakers.
- **Game library (200,000+ games via IGDB) with live deal pricing** — rich metadata from IGDB paired with live IsThereAnyDeal pricing and "most-played" / best-deal discovery.
- **Steam integration** — link Steam to sync wishlists and playtime, feeding smarter game picks and deal alerts.
- **Player taste profiles & archetypes** — fun archetypes (Casual → Hardcore, Duelist, and more) built from real play signals.
- **Characters & WoW Classic import** — pull World of Warcraft Classic toons straight from the Blizzard API.
- **Community insights & analytics** — attendance trends, event metrics, churn risk, and social-clique detection.
- **Auto-detected ad-hoc events** — spontaneous voice sessions get captured as events automatically.

### ✨ Recently shipped

- **Ephemeral voice channels** — auto-created per event (with a force-ephemeral option) and torn down on completion.
- **Running-late markers + one-tap host delay** (+15 / +30 min) that preserve existing confirmations.
- **Scheduling polls** with group availability heatmaps, deadlines, and tiebreakers.
- **Community lineups** with Common Ground scoring and AI-assisted (including wildcard) game suggestions.
- **Live IsThereAnyDeal price tracking** and community game-discovery rows.
- **Steam wishlist & playtime sync** feeding personalized discovery.
- **Player taste profiles & archetypes** derived from real play signals.

---

## 🚀 Quick Deploy

The whole stack — app, PostgreSQL, and Redis — runs from a single container. Mount a volume so your data and backups survive container recreation:

```bash
docker run -d --name raid-ledger -p 80:80 -v raid-ledger-data:/data ghcr.io/sjdodge123/raid-ledger:main
```

Then open **http://localhost** and grab your admin password from the container logs (see below).

### Get Admin Password

Check container logs for your initial credentials:

```
========================================================
  INITIAL ADMIN CREDENTIALS
========================================================
  Email:    admin@local
  Password: xK9mP2vL...
--------------------------------------------------------
  Save this password! It will not be shown again.
  To reset, set RESET_PASSWORD=true and restart.
========================================================
```

### Reset Admin Password

```bash
docker run -e RESET_PASSWORD=true -e ADMIN_PASSWORD=mynewpassword -p 80:80 -v raid-ledger-data:/data ghcr.io/sjdodge123/raid-ledger:main
```

`RESET_PASSWORD=true` alone generates a new random password and prints it to the logs; add `ADMIN_PASSWORD` to choose the value.

### Configure Discord OAuth

1. Log in at http://localhost
2. Go to **Admin Settings** → **Discord OAuth**
3. Follow the in-app instructions

> **Try it first:** demo data can be installed (and removed) from the **Admin Panel** after logging in, so you can explore a fully-populated community before wiring up Discord.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `80` | Port to expose the application |
| `ADMIN_PASSWORD` | *(random)* | Set a specific admin password on first run; combine with `RESET_PASSWORD=true` to change an existing password |
| `RESET_PASSWORD` | `false` | Set to `true` to reset the admin password on startup (new password is printed to the container logs) |
| `DEBUG` | `false` | Enable verbose logging (query details, startup diagnostics, plugin internals) |
| `DISABLE_TELEMETRY` | `false` | Set to `true` to disable anonymous error reporting to the maintainers via Sentry |

**Example with custom port:**
```bash
docker run -d -p 8080:80 -v raid-ledger-data:/data ghcr.io/sjdodge123/raid-ledger:main
```

---

## Database Backups

Raid Ledger automatically backs up your PostgreSQL database to `/data/backups/` inside the Docker volume — keep the `-v` volume mount from the Quick Deploy command and your history persists across container recreation.

### How it works

- **Daily backups** — A `pg_dump` runs every night and stores compressed `.dump` files in `/data/backups/daily/`. Backups older than 30 days are automatically deleted.
- **Pre-migration snapshots** — Before every schema migration at container startup, a snapshot is saved to `/data/backups/migrations/`. These are not auto-rotated and should be cleaned up manually when no longer needed.
- **Web UI** — You can also manage backups from **Admin Panel → Backups**, which lets you create, download, delete, and restore backups (restores take an automatic pre-restore safety snapshot).

### Accessing backups

```bash
# List available backups
docker exec raid-ledger ls /data/backups/daily/
docker exec raid-ledger ls /data/backups/migrations/

# Copy a backup to the host
docker cp raid-ledger:/data/backups/daily/<backup-file>.dump ./restore.dump
```

### Restoring a backup

```bash
# Copy the dump into the container and restore inside it
docker cp ./restore.dump raid-ledger:/tmp/restore.dump
docker exec raid-ledger su-exec postgres pg_restore --dbname raid_ledger \
  --no-owner --no-privileges /tmp/restore.dump
```

Or restore from **Admin Panel → Backups**, which also takes a pre-restore safety snapshot.

### Backup preservation across --fresh resets

Both `deploy_dev.sh --fresh` and `deploy_prod.sh --fresh` take a safety `pg_dump` into `api/backups/daily/` on the host filesystem before wiping volumes — host-side backups survive fresh resets automatically.

---

## Health Check

```
http://localhost/api/health
```

---

## Tech Stack

Raid Ledger is a TypeScript monorepo:

- **`api`** — NestJS backend (events, signups, attendance, notifications, the Discord bot, IGDB/Steam/ITAD enrichment), backed by PostgreSQL + Drizzle ORM and Redis/BullMQ for queues.
- **`web`** — React + Vite single-page dashboard.
- **`packages/contract`** — shared Zod schemas + types that keep the API and web client in lockstep.

Production ships as a single all-in-one Docker image bundling the API, web build, PostgreSQL, and Redis.

## Development

Local development uses the deploy script, which brings up Docker, runs migrations, seeds data, and starts the API (`:3000`) and web (`:5173`) in watch mode:

```bash
npm install
./scripts/deploy_dev.sh          # add --rebuild to rebuild the contract, --fresh to reset the DB
```

See `CLAUDE.md` and `project-context.md` for architecture, conventions, and the full toolchain.

---

## Documentation

- **[Live site](https://sjdodge123.github.io/Raid-Ledger/)** — feature tour, screenshots, and quick start
- **[Wiki](https://github.com/sjdodge123/Raid-Ledger/wiki)** — setup guides, feature docs, operations, and API reference

---

## License

MIT
</content>
</invoke>
