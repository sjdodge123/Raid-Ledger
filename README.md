# Raid Ledger

A unified dashboard for gaming communities—plan raids and events, track schedules and attendance, and boost engagement.

## 🚀 Quick Deploy

### Requirements
- Docker
- PostgreSQL database
- Redis instance

### Run

```bash
docker run -d \
  -p 80:80 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/raid_ledger \
  -e REDIS_URL=redis://host:6379 \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  ghcr.io/sjdodge123/raid-ledger:main
```

### Get Admin Password

Check the container logs for your initial credentials:

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

### Configure Discord OAuth

1. Log in at http://localhost
2. Go to **Admin Settings** → **Discord OAuth**
3. Follow the in-app instructions

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing |
| `DEMO_MODE` | No | Set `true` to seed sample data |

---

## Health Checks

- **API:** http://localhost/api/health
- **Nginx:** http://localhost/nginx-health

---

## Development

```bash
# Start local infrastructure
docker compose up -d

# Install dependencies
npm install

# Run API + Web dev servers
npm run dev
```

---

## License

MIT
