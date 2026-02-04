# Raid Ledger

RaidLedger is a unified dashboard for gaming communities—plan raids and events, track schedules and attendance, boost engagement, and monitor game server uptime with smart automation so your group stays organized and online.

## 🚀 Quick Start (Docker)

### Prerequisites
- Docker and Docker Compose installed
- Copy `.env.docker.example` to `.env.docker` and configure

### Deploy from Source

```bash
# Clone the repository
git clone https://github.com/your-username/raid-ledger.git
cd raid-ledger

# Configure environment
cp .env.docker.example .env.docker
# Edit .env.docker with your settings (at minimum: POSTGRES_PASSWORD and JWT_SECRET)

# Start all services
docker compose -f docker-compose.prod.yml --env-file .env.docker up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

### Deploy from GHCR (Pre-built Images)

Pre-built images are published to GitHub Container Registry on every push to `main`:

```bash
# Pull the latest images
docker pull ghcr.io/your-username/raid-ledger/api:main
docker pull ghcr.io/your-username/raid-ledger/web:main

# Or use a specific version tag
docker pull ghcr.io/your-username/raid-ledger/api:v1.0.0
docker pull ghcr.io/your-username/raid-ledger/web:v1.0.0
```

To use pre-built images, create a `docker-compose.override.yml`:

```yaml
services:
  api:
    image: ghcr.io/your-username/raid-ledger/api:main
    build: !reset null
  web:
    image: ghcr.io/your-username/raid-ledger/web:main
    build: !reset null
```

Then run: `docker compose -f docker-compose.prod.yml -f docker-compose.override.yml --env-file .env.docker up -d`

The application will be available at `http://localhost` (or your configured PORT).

### Services

| Service | Port | Description |
|---------|------|-------------|
| **web** | 80 | Nginx serving React SPA + API proxy |
| **api** | 3000 (internal) | NestJS API server |
| **db** | 5432 (internal) | PostgreSQL database |
| **redis** | 6379 (internal) | Redis cache |

### Health Checks

| Endpoint | Description |
|----------|-------------|
| `http://localhost/api/health` | API health status |
| `http://localhost/nginx-health` | Nginx health status |

### Environment Variables

See `.env.docker.example` for all available options. Required variables:

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | JWT signing secret (generate with `openssl rand -base64 32`) |

Optional variables for enhanced functionality:

| Variable | Description |
|----------|-------------|
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `IGDB_CLIENT_ID` | Twitch/IGDB API client ID for game discovery |
| `IGDB_CLIENT_SECRET` | Twitch/IGDB API client secret |

---

## 🛠️ Development

### Local Development

```bash
# Start infrastructure (Postgres + Redis)
docker compose up -d

# Install dependencies
npm install

# Run API and Web in development mode
npm run dev -w @raid-ledger/api
npm run dev -w @raid-ledger/web
```

### Project Structure

```
raid-ledger/
├── api/                 # NestJS backend
├── web/                 # React + Vite frontend
├── packages/
│   └── contract/        # Shared TypeScript types
├── nginx/               # Nginx configuration
├── docker-compose.yml   # Development infrastructure
└── docker-compose.prod.yml  # Production deployment
```

### Testing

```bash
npm run test           # Run all tests
npm run test -w api    # Run API tests only
npm run test -w web    # Run Web tests only
```

---

## 📄 License

MIT
