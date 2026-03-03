# Raid Ledger

[![Documentation](https://img.shields.io/badge/docs-wiki-blue)](https://github.com/sjdodge123/Raid-Ledger/wiki)
[![Website](https://img.shields.io/badge/site-GitHub%20Pages-indigo)](https://sjdodge123.github.io/Raid-Ledger/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A unified dashboard for gaming communities—plan raids and events, track schedules and attendance, and boost engagement.

## 🚀 Quick Deploy

```bash
docker run -d -p 80:80 ghcr.io/sjdodge123/raid-ledger:main
```

That's it! The container includes PostgreSQL, Redis, and the full application.

### Get Admin Password

Check container logs for your initial credentials:

```
╔════════════════════════════════════════════════════════════╗
║          🔐 INITIAL ADMIN CREDENTIALS                      ║
╠════════════════════════════════════════════════════════════╣
║  Email:    admin@local                                     ║
║  Password: xK9mP2vL...                                     ║
╠════════════════════════════════════════════════════════════╣
║  ⚠️  Save this password! It will not be shown again.       ║
╚════════════════════════════════════════════════════════════╝
```

### Reset Admin Password

```bash
docker run -e ADMIN_PASSWORD=mynewpassword -p 80:80 ghcr.io/sjdodge123/raid-ledger:main
```

### Configure Discord OAuth

1. Log in at http://localhost
2. Go to **Admin Settings** → **Discord OAuth**
3. Follow the in-app instructions

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `80` | Port to expose the application |
| `ADMIN_PASSWORD` | *(random)* | Set a specific admin password; updates on every startup if set |
| `DEBUG` | `false` | Enable verbose logging (query details, startup diagnostics, plugin internals) |
| `DISABLE_TELEMETRY` | `false` | Set to `true` to disable anonymous error reporting to the maintainers via Sentry |


**Example with custom port:**
```bash
docker run -d -p 8080:80 ghcr.io/sjdodge123/raid-ledger:main
```

> **Demo data** can be installed (and removed) from the **Admin Panel** after logging in.

---

## Database Backups

Raid Ledger automatically backs up your PostgreSQL database to `/data/backups/` inside the Docker volume.

### How it works

- **Daily backups** — A `pg_dump` runs every night at 2 AM and stores compressed `.dump` files in `/data/backups/daily/`. Backups older than 30 days are automatically deleted.
- **Pre-migration snapshots** — Before every schema migration at container startup, a snapshot is saved to `/data/backups/migrations/`. These are not auto-rotated and should be cleaned up manually when no longer needed.

### Accessing backups

```bash
# List available backups
docker exec raid-ledger-api ls /data/backups/daily/
docker exec raid-ledger-api ls /data/backups/migrations/

# Copy a backup to the host
docker cp raid-ledger-api:/data/backups/daily/raid_ledger_2024-01-15_020001.dump ./restore.dump
```

### Restoring a backup

```bash
# Restore from a custom-format dump
pg_restore --host localhost --port 5432 --username user --dbname raid_ledger \
  --no-owner --no-privileges ./restore.dump
```

### Backup preservation across --fresh resets

Both `deploy_dev.sh --fresh` and `deploy_prod.sh --fresh` automatically preserve and restore the `/data/backups/` directory across the volume wipe — your backup history is never lost during a fresh reset.

---

## Health Check

```
http://localhost/api/health
```

---

## Development

For local development with separate services:

```bash
docker compose up -d          # Start db + redis
npm install
npm run dev                   # Run API + Web
```

---

## Documentation

- **[Wiki](https://github.com/sjdodge123/Raid-Ledger/wiki)** — Setup guides, feature docs, operations, and API reference
- **[Marketing Site](https://sjdodge123.github.io/Raid-Ledger/)** — Feature overview and quick start

---

## License

MIT
