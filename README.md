# Raid Ledger

A unified dashboard for gaming communities—plan raids and events, track schedules and attendance, and boost engagement.

## 🚀 Deploy with Docker

### 1. Clone & Start

```bash
git clone https://github.com/sjdodge123/raid-ledger.git
cd raid-ledger
docker compose --profile test up -d
```

### 2. Get Admin Password

On first startup, check the **API container logs** for your initial credentials:

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

### 3. Configure Discord OAuth

1. Log in at http://localhost (or your configured PORT)
2. Go to **Admin Settings** → **Discord OAuth**
3. Follow the in-app instructions to connect Discord

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `80` | Web UI port |
| `DEMO_MODE` | `false` | Set `true` to seed sample data |

**Example:**
```bash
PORT=8080 docker compose --profile test up -d
```

---

## Health Checks

- **API:** http://localhost/api/health
- **Nginx:** http://localhost/nginx-health

---

## Development

```bash
docker compose up -d          # Start database only
npm install
npm run dev                   # Run API + Web
```

---

## License

MIT
