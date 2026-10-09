# Agent Configuration

This file provides configuration and guidance for AI agents working on this codebase.

## UI Testing

### Port Configuration

| Service | Port | Usage |
|---------|------|-------|
| **Web (Vite)** | 5173 | ✅ Use for all browser testing |
| API | 3000 | Internal API, exposed for debugging |
| PostgreSQL | 5432 | Database (loopback-only) |
| Redis | 6379 | Cache (loopback-only) |

**Browser tests target `http://localhost:5173`**
- This is Playwright's default baseURL; override with `BASE_URL`/`PLAYWRIGHT_BASE_URL` for fleet slot URLs
- If :5173 is not responding, run `./scripts/deploy_dev.sh` first

### Starting Test Environment

```bash
# Start dev environment (Docker DB/Redis + API watch mode + Vite)
./scripts/deploy_dev.sh

# Rebuild contract package and start (after code changes) — non-interactive for agents
./scripts/deploy_dev.sh --ci --rebuild

# Stop everything
./scripts/deploy_dev.sh --down
```

> **Env lock**: The dev env is a single shared resource — check `mcp__mcp-env__env_lock_status` before deploying and release with `env_lock_release` (or `deploy_dev.sh --down`) when done. `deploy_dev.sh` refuses to start if another worktree holds the lease.

> **Demo Data**: Use the Admin Panel to install or remove demo data (games, events, users, signups, and availability).

### Browser Testing

**Use Playwright CLI for E2E testing:**
```bash
npx playwright test --reporter=list
```

### Two Testing Paths

| Script | Mode | Purpose |
|--------|------|---------|
| `./scripts/deploy_dev.sh --ci --rebuild` | Full stack | UI testing (install demo data via Admin Panel) |
| `./scripts/deploy_dev.sh --fresh` | Full stack | Bootstrap flow testing (resets DB, generates a new admin password) |

Use the **Admin Panel** to install demo data after starting the test environment.

### Verification Workflow

For browser verification, drive the changed flows via Chrome MCP against the deployed dev env — see `.claude/skills/_shared/chrome-mcp-e2e.md`. Scripted e2e: `./scripts/validate-ci.sh --only-e2e`.

### Pre-push validation

Run `./scripts/validate-ci.sh --static` (build + typecheck + lint) before pushing. Escalate to `--full` for migration, infra, or `packages/contract/**` changes. GitHub CI is the real gate — auto-merge blocks until green.

### Typecheck commands (Codex reviews run read-only)

Reviews run in a read-only sandbox, so any command that writes fails: `npm run build` in any workspace writes `dist/` (and `nest build` has no `--noEmit` flag). Typecheck from the **repo root** without writing:

- **API:** `npx tsc --noEmit --incremental false -p api/tsconfig.json` — the invocation `scripts/validate-ci.sh` `run_typecheck` uses (validate-ci.sh:668), plus `--incremental false` because `api/tsconfig.json` sets `incremental: true` and would otherwise write `api/dist/tsconfig.tsbuildinfo`. Do not `cd api` first: that form floods with jest-globals errors (TECH-DEBT-BACKLOG TDB:524), because it resolves the workspace's pinned TypeScript 6.0.3 instead of the hoisted 5.9.3 the root form and the gate use.
- **Web:** the three no-emit leaf configs `validate-ci.sh` runs (validate-ci.sh:679-681): `npx tsc --noEmit -p web/tsconfig.app.json`, `-p web/tsconfig.node.json` and `-p web/tsconfig.test.json`. Never `-p web/tsconfig.json` — it is solution-style and checks 0 files (see `TESTING.md` "Web typecheck"). Not `npm run build -w web` either: it writes `web/dist`.
- **No test suites:** do not run jest, vitest or Playwright — suites run on the fleet and GitHub CI. The repo gate is `./scripts/validate-ci.sh --static`.

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

Use `./scripts/deploy_dev.sh --ci --rebuild` for full-stack testing (API on :3000, web on :5173).

## Authentication

### Bootstrap Admin

On first run, the deploy script (`./scripts/deploy_dev.sh`) creates:
- **Username:** `admin@local`
- **Password:** Generated and shown in script output (`--reset-password` regenerates it without data loss)

### Discord OAuth

Optional. Configure via environment variables if needed.
