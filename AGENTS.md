# Agent Configuration

This file provides configuration and guidance for AI agents working on this codebase.

## UI Testing

### Port Configuration

| Service | Port | Usage |
|---------|------|-------|
| **Web (nginx)** | 80 | ✅ Use for all browser testing |
| API | 3000 | Internal API, exposed for debugging |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache |

**CRITICAL: Browser tests must use `http://localhost:80`**
- Never fallback to ports 5173, 3000, or any alternatives
- If port 80 is not responding, containers need to be started

### Starting Test Environment

```bash
# Start containers (uses cached images)
./scripts/test-ui.sh

# Rebuild and start (after code changes)
./scripts/test-ui.sh --rebuild

# Stop containers
./scripts/test-ui.sh --down
```

> **Demo Data**: Use the Admin Panel to install or remove demo data (games, events, users, signups, and availability).

### Browser Testing

**Use Playwright CLI for E2E testing:**
```bash
npx playwright test --reporter=list
```

### Two Testing Paths

| Script | Mode | Purpose |
|--------|------|---------|
| `./scripts/test-ui.sh` | Full stack | UI testing (install demo data via Admin Panel) |
| `./scripts/test-production.sh` | Full stack | Bootstrap flow testing (empty database) |

Use the **Admin Panel** to install demo data after starting the test environment.

### Verification Workflow

Use `/verify-ui` workflow for browser testing. See `.agent/workflows/verify-ui.md`.

## Pull Requests

When creating pull requests, always use **squash merge** with **auto-merge** enabled:

```bash
gh pr create --title "..." --body "..."
gh pr merge --squash --auto
```

## Development

### Local Development (without Docker)

```bash
# Start infrastructure only
docker compose up -d db redis

# Run API
cd api && npm run start:dev

# Run Web (separate terminal)
cd web && npm run dev
```

This serves:
- API on http://localhost:3000
- Web on http://localhost:5173

### Full Docker Testing

Use `./scripts/test-ui.sh` for production-like testing on port 80.

## Authentication

### Bootstrap Admin

On first run, the test script creates:
- **Username:** `admin@local`
- **Password:** Generated and shown in script output

### Discord OAuth

Optional. Configure via environment variables if needed.
