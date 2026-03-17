# Raid Ledger

Monorepo: `api` (NestJS), `web` (React/Vite), `packages/contract` (shared types).

## Key References

- **Project context:** `project-context.md` — architecture, stack, conventions
- **Testing guide:** `TESTING.md` — patterns, anti-patterns, coverage thresholds, exemplary files

## Pull Requests

- **Always enable auto-merge (squash)** after creating or pushing to a PR: `gh pr merge <branch> --auto --squash`
- This is safe to run whether the PR was just created or already existed — it's a no-op if already enabled.

## Local Dev Environment

- **Start everything:** `./scripts/deploy_dev.sh` — ensures Docker is up, runs migrations, seeds data, starts API + web in watch mode
- **Flags:** `--rebuild` (rebuild contract), `--fresh` (reset DB), `--reset-password`, `--branch <name>`, `--ci` (non-interactive, for agents), `--down`, `--status`, `--logs`
- **Worktree-safe:** The deploy script auto-detects worktrees, copies `.env` + `api/.env` from the main repo, and always uses the correct Docker volumes. Just run `./scripts/deploy_dev.sh --ci --rebuild` from any worktree.
- **Ports:** API on `:3000`, Web on `:5173` (Vite may increment to `:5174` if `:5173` is in use — CORS allows both)
- **DEMO_MODE=true** in root `.env` enables auth bypass with prefilled credentials
- **Docker volume gotcha (handled automatically):** The deploy script uses `docker start` by name first, falling back to `docker compose` from the main repo's compose file. This prevents worktrees from creating separate volumes with wrong directory prefixes.

## Code Size Limits (STRICT — enforced by ESLint)

- **Max 300 lines per file** (`max-lines: warn`, skipBlankLines + skipComments) — will be upgraded to `error` once existing violations are resolved
- **Max 30 lines per function** (`max-lines-per-function: warn`, skipBlankLines + skipComments) — will be upgraded to `error` once existing violations are resolved
- **Design small from the start** — do not write large files and refactor after. Plan focused modules, extract helpers/sub-services/child components proactively.
- Test files (`*.spec.ts`, `*.test.tsx`) have a relaxed **750-line** file limit (not 300).
- Migration files are exempt from both limits.

## Infrastructure Changes (STRICT — Dockerfiles, entrypoints, nginx)

**Two deployment topologies exist — understand BOTH before changing either:**
- `api/Dockerfile` — API-only image for docker-compose dev/test (user: `nestjs`, Redis via TCP)
- `Dockerfile.allinone` — Production monolith for Synology NAS (user: `app`, supervisor, Redis via Unix socket at `/tmp/redis.sock` with `770` perms)

**Mandatory before pushing ANY infrastructure change:**
1. Read BOTH Dockerfiles to understand what your change affects
2. Build the allinone image locally: `docker build -f Dockerfile.allinone -t rl:test .`
3. Start it: `docker run --rm -d --name rl-test -p 8080:80 rl:test`
4. Verify: `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`
5. Cleanup: `docker stop rl-test`

**Rules:**
- Infrastructure changes get their OWN PR — never bundle with code changes
- Never merge infrastructure PRs without CI passing (container-startup job)
- One fix per outage attempt. If a hotfix fails, REVERT to last known good state — do not stack more fixes
- The allinone entrypoint runs as root (supervisor manages child process users) — do NOT add privilege dropping to `docker-entrypoint.sh`

## Testing

- **Backend:** `npm run test -w api` (Jest). Coverage: `npm run test:cov -w api`
- **Frontend:** `npm run test -w web` (Vitest). Coverage: `cd web && npx vitest run --coverage`
- **Smoke tests:** `npx playwright test` (Playwright, requires DEMO_MODE=true for auth flows)
- **Read `TESTING.md` before writing or modifying any test file.**
- Shared test infra: `api/src/common/testing/` (drizzle-mock, factories), `web/src/test/` (MSW handlers, render helpers, factories)
