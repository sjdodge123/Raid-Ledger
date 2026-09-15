# Raid Ledger

[![Website](https://img.shields.io/badge/live%20site-GitHub%20Pages-6d28d9)](https://sjdodge123.github.io/Raid-Ledger/)
[![Documentation](https://img.shields.io/badge/docs-wiki-blue)](https://github.com/sjdodge123/Raid-Ledger/wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Run your entire raid operation from inside Discord.** Raid Ledger is a self-hosted, Discord-native dashboard for gaming communities — members sign in with Discord, RSVP to bot-posted event embeds, get DM reminders, and drop into voice channels that spin up automatically per event. Scheduling, signups, attendance, and "what are we playing tonight?" all run themselves.

Built for raid leaders, clan officers, and server owners who are tired of herding players across pinned messages, reaction polls, and attendance spreadsheets.

> 🌐 **[See it in action → sjdodge123.github.io/Raid-Ledger](https://sjdodge123.github.io/Raid-Ledger/)** — screenshots and a feature tour.

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

---

## Setup — the three required steps

Everything (app, PostgreSQL, Redis) runs from **one container**. There is nothing to configure before the first start; the only things you decide are a port and an admin password.

### 1. Run the container

Portainer, Synology Container Manager, unRAID, or plain Docker Compose — paste this stack:

```yaml
services:
  raid-ledger:
    image: ghcr.io/sjdodge123/raid-ledger:main
    container_name: raid-ledger
    restart: unless-stopped
    ports:
      - "8080:80"                 # <any free host port>:80 — the container always listens on 80
    volumes:
      - raid-ledger-data:/data    # a NAMED volume — not a host folder (see Troubleshooting)
    environment:
      ADMIN_PASSWORD: "choose-a-real-password"   # used when the admin account is first created

volumes:
  raid-ledger-data:
```

Or, without Compose:

```bash
docker run -d --name raid-ledger --restart unless-stopped \
  -p 8080:80 -v raid-ledger-data:/data \
  -e ADMIN_PASSWORD=choose-a-real-password \
  ghcr.io/sjdodge123/raid-ledger:main
```

The first start takes about a minute (database init, migrations). The container reports **healthy** once the app answers.

### 2. Sign in as the admin

Open `http://<your-host>:8080/login`, choose **Sign in with username instead**, and log in as **`admin@local`** with the password you set.

If you did not set `ADMIN_PASSWORD`, a random one was generated and printed **once**, in the first screen of the container log:

```
========================================================
  INITIAL ADMIN CREDENTIALS
========================================================
  Email:    admin@local
  Password: xK9mP2vL...
========================================================
```

Lost it? See *Forgot the admin password* under Troubleshooting.

### 3. Connect Discord

This is what lets your community sign in and what powers the bot. All of it happens in the app; nothing goes in the container config.

1. In the [Discord Developer Portal](https://discord.com/developers/applications) create an application. On its **Bot** tab click **Reset Token** and copy the token; under **Privileged Gateway Intents** enable **Presence**, **Server Members** and **Message Content**, then save.
2. In Raid Ledger go to **Admin Settings → Discord → Connection**, paste the bot token, save.
3. Use the **invite URL shown on that page** to add the bot to your server. Don't hand-build an OAuth2 URL — the generated one requests exactly the permissions this version needs (including *Manage Channels* and the thread permissions the LFG board relies on).
4. Go to **Admin Settings → Discord OAuth** and follow the in-app instructions so members can sign in with Discord.

**That is the whole setup.** Members sign in with Discord; you keep `admin@local` as the break-glass account.

> **Want to look around first?** Demo data can be installed (and removed) from the **Admin Panel**, so you can explore a fully populated community before wiring up Discord.

---

## Optional settings

Every variable has a working default. Set these only if you need them.

| Variable | Default | What it does |
|----------|---------|--------------|
| `ADMIN_PASSWORD` | *(random, printed once)* | The admin password **when the account is first created**. On an existing account it does nothing by itself — pair it with `RESET_PASSWORD`. |
| `RESET_PASSWORD` | `false` | Set to `true` for **one** start to reset the admin password (with `ADMIN_PASSWORD` to choose it, otherwise a new random one is printed to the log). Remove it afterwards. |
| `PORT` | `80` | The port the container listens on. You normally leave this alone and change the **host** side of the port mapping instead. |
| `DEBUG` | `false` | Verbose logging (query details, startup diagnostics). |
| `DISABLE_TELEMETRY` | `false` | `true` disables anonymous error reporting to the maintainers (Sentry). |

**Updates.** Pull the `:main` tag and recreate the container; migrations run on start and a pre-migration snapshot is taken first. Watchtower works.

**Backups.** A `pg_dump` runs nightly into `/data/backups/daily/` (kept 30 days) and a snapshot lands in `/data/backups/migrations/` before every migration. **Admin Panel → Backups** lets you create, download, delete and restore them from the browser. From the shell:

```bash
docker exec raid-ledger ls /data/backups/daily/
docker cp raid-ledger:/data/backups/daily/<file>.dump ./restore.dump
# restore one:
docker cp ./restore.dump raid-ledger:/tmp/restore.dump
docker exec raid-ledger su-exec postgres pg_restore --dbname raid_ledger --no-owner --no-privileges /tmp/restore.dump
```

**Health check.** `http://<your-host>:8080/api/health` — the container's own health check probes `/api/health/live`.

---

## Troubleshooting a first deploy

**`❌ FATAL: /data is not writable by the app user (uid 1001).`** — you mounted a host folder (for example `/volume1/docker/raid-ledger:/data`). NAS permission systems keep their own ACLs there, the container's `chown` does not stick, and rather than crash-loop the container stops with this line. Switch to a named volume (the stack above), or make the folder writable with `chmod -R a+rwX /path/to/folder`, and start it again.

**The container is "unhealthy".** The app is not answering yet. Read the **first** screen of the container log, not the last: the real cause is printed once at the top, while the restart noise repeats forever.

**`https://…` fails, or `http://…` loads and then stays blank.** The container speaks plain HTTP, so open it with **`http://`** — `https://<nas-ip>:8080` has nothing to answer it. Want HTTPS? Put it behind a TLS reverse proxy (on a Synology: Control Panel → Login Portal → Advanced → Reverse Proxy, source `https://<your-host>` → destination `http://localhost:8080`, with the NAS certificate) — the app detects the proxy's `X-Forwarded-Proto` and turns on its HTTPS-only security headers.

**The page never loads / "connection refused".** Check the port mapping: the container listens on **80**, so the mapping must be `<host port>:80` (for example `8080:80`). `8080:8080` maps to nothing.

**"driver failed programming external connectivity" / port already allocated.** Something on the host already owns that port (on a Synology, DSM owns 80 and 443). Pick another host port, for example `8080:80`.

**Forgot the admin password.** Start the container **once** with `RESET_PASSWORD=true` and `ADMIN_PASSWORD=<your choice>`, log in, then remove `RESET_PASSWORD`. Every start after the first prints a reminder of this recipe in the log.

**The Discord connection page says a permission is missing.** Discord grants a bot's permissions at install time; editing the application later does not change an existing install. Open the invite URL from the Connection page again and re-authorise — the bot keeps its channel bindings.

---

## Tech stack & development

A TypeScript monorepo: **`api`** (NestJS, PostgreSQL + Drizzle, Redis/BullMQ, the Discord bot), **`web`** (React + Vite), **`packages/contract`** (shared Zod schemas). Production ships as one all-in-one image bundling the API, web build, PostgreSQL and Redis.

```bash
npm install
./scripts/deploy_dev.sh          # local dev: Docker, migrations, seed data, API :3000 + web :5173 in watch mode
```

See `CLAUDE.md` and `project-context.md` for architecture, conventions and the toolchain.

## Documentation

- **[Live site](https://sjdodge123.github.io/Raid-Ledger/)** — feature tour, screenshots
- **[Wiki](https://github.com/sjdodge123/Raid-Ledger/wiki)** — setup guides, feature docs, operations, API reference

## License

MIT
