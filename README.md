# Raid Ledger

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

**Example with custom port:**
```bash
docker run -d -p 8080:80 ghcr.io/sjdodge123/raid-ledger:main
```

> **Demo data** can be installed (and removed) from the **Admin Panel** after logging in.

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

## License

MIT
