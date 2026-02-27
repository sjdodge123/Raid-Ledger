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

## Testing

- **Backend:** `npm run test -w api` (Jest). Coverage: `npm run test:cov -w api`
- **Frontend:** `npm run test -w web` (Vitest). Coverage: `cd web && npx vitest run --coverage`
- **Smoke tests:** `npx playwright test` (Playwright, requires DEMO_MODE=true for auth flows)
- **Read `TESTING.md` before writing or modifying any test file.**
- Shared test infra: `api/src/common/testing/` (drizzle-mock, factories), `web/src/test/` (MSW handlers, render helpers, factories)
