# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Raid-Ledger is a full-stack TypeScript gaming community management app for planning raids/events, tracking schedules, and managing team rosters. It uses an npm workspaces monorepo with three packages:

- **`api/`** — NestJS 11.x backend (PostgreSQL + Drizzle ORM, Redis, JWT/Discord OAuth)
- **`web/`** — React 19.x + Vite 7.x frontend (TanStack Query, Zustand, TailwindCSS)
- **`packages/contract/`** — Shared Zod schemas that define all API DTOs and frontend types

## Build & Development Commands

### Build order matters
Contract must build before api or web:
```bash
npm run build -w packages/contract   # Must run first
npm run build -w api
npm run build -w web
```

### Local development (without Docker)
```bash
docker compose up -d db redis        # Start Postgres + Redis
npm run start:dev -w api             # API on :3000 (watch mode)
npm run dev -w web                   # Web on :5173
```

### Full Docker stack
```bash
docker-compose --profile test up     # All services
```

### Testing
```bash
npm run test -w api                  # Jest (backend)
npm run test -w web                  # Vitest (frontend)
npm run test                         # All workspaces
npx playwright test                  # E2E (requires Docker stack running)
```

Run a single test file:
```bash
npx jest --config api/jest.config.js -- path/to/file.spec.ts     # Backend
npx vitest run web/src/path/to/file.test.tsx                      # Frontend
```

### Linting & Formatting
```bash
npm run lint -w api                  # ESLint fix (backend)
npm run lint -w web                  # ESLint (frontend)
npm run lint                         # All workspaces
```
Prettier is the authoritative formatter. ESLint 9.x flat config is used.

### Database
```bash
npm run db:generate -w api           # Generate migrations from schema changes
npm run db:migrate -w api            # Apply migrations
npm run db:seed:games -w api         # Seed game data
npm run db:seed:admin -w api         # Seed admin user
./scripts/fix-migration-order.sh     # Validate/fix migration timestamp order
```

**After generating or merging migrations**, always run `./scripts/fix-migration-order.sh` to ensure journal timestamps are monotonically increasing. Out-of-order timestamps cause Drizzle to silently skip migrations. The script auto-fixes any issues; use `--check` for CI/validation-only mode.

## Architecture

### Shared Contract (`packages/contract`)
Single source of truth for all types. Zod schemas define DTOs that both api and web consume. Changes here require verification across both api and web. Never duplicate types between contract and app code.

### Backend (`api/`)
NestJS modular architecture. Key modules: `auth/` (JWT + Discord OAuth + local), `events/` (event management + signups), `characters/`, `availability/` (uses PostgreSQL `tsrange`), `notifications/`, `game-registry/`, `roster/`, `drizzle/` (schema + migrations). Database schema is defined across individual module schema files and re-exported from `src/drizzle/schema.ts`. Test files are co-located as `*.spec.ts`.

### Frontend (`web/`)
Pages in `src/pages/`, components organized by domain in `src/components/`. Custom hooks in `src/hooks/` wrap TanStack Query for API calls. `src/lib/api-client.ts` is the REST client. Path alias `@` maps to `src/`. Test files are co-located as `*.test.tsx`.

## Critical Rules

- **Branch-per-story + PR workflow** — Multiple agents may work in this repo concurrently via git worktrees. **Always** create a branch from `main` for each story (e.g., `rok-123-feature-name`). Dev teammates commit to their feature branch but do **not** push or create PRs — the lead handles all GitHub operations. The operator tests locally on the feature branch with `deploy_dev.sh` before pushing. When ready, the lead pushes the branch, creates a GitHub PR (`gh pr create --base main`), and enables auto-merge (`gh pr merge --auto --squash`). The PR auto-merges to `main` once CI passes. Never commit directly to `main` for story/feature work. Clean up worktrees and branches immediately after PR merge.
- **Zod-first validation** — All data validation uses Zod schemas from the contract package
- **TypeScript strict mode** — No `any` allowed in either api or web
- **Naming conventions** — Files: `kebab-case`, Classes: `PascalCase`, Variables: `camelCase`, DB columns: `snake_case` (mapped in Drizzle)
- **Availability domain** — Uses PostgreSQL `tsrange` for scheduling/matchmaking, not simple start/end timestamps
- **Discord Bot** — Module inside `api/`, not a separate service
- **Database schema changes** — Use Drizzle Kit migrations only, never modify schema manually
- **npm config** — `.npmrc` has `legacy-peer-deps=true` for NestJS compatibility

## GitHub Branch Protection

GitHub branch protection rules are enforced on `main` to prevent destructive operations and ensure code quality.

### Main Branch Protection

- ✅ **Requires Pull Request** — No direct commits allowed, all changes via PR
- ✅ **Requires CI checks to pass** — `build-lint-test` and `merge` workflows must succeed
- ✅ **Requires conversation resolution** — All PR comments must be resolved
- ✅ **Blocks force pushes** — Protects git history from being rewritten
- ✅ **Blocks branch deletion** — Prevents accidental removal
- ✅ **Enforces on admins** — Rules apply to everyone, no bypassing
- ✅ **Auto-merge enabled** — PRs auto-merge (squash) once CI passes

**Impact:** PRs auto-merge once CI passes and all conversations are resolved. Direct pushes to `main` will be rejected.

### Managing Branch Protection

Update or restore branch protection rules anytime:
```bash
./scripts/setup-branch-protection.sh
```

The script is idempotent and safe to run multiple times. It configures `main` branch protection and enables auto-merge via GitHub API.

## Deploy Scripts

Both scripts share the same Docker DB volume and `.env` `ADMIN_PASSWORD` — the admin password never desyncs between dev and prod.

### Local development (`deploy_dev.sh`)
Runs native API (watch mode) + Vite dev server against Docker DB + Redis:
```bash
./scripts/deploy_dev.sh                  # Start dev environment
./scripts/deploy_dev.sh --rebuild        # Rebuild contract package, then start
./scripts/deploy_dev.sh --branch rok-123 # Switch to feature branch, rebuild, then start
./scripts/deploy_dev.sh --fresh          # Reset DB, new admin password, restart
./scripts/deploy_dev.sh --reset-password # Reset admin password (no data loss)
./scripts/deploy_dev.sh --down           # Stop everything
./scripts/deploy_dev.sh --status         # Show process/container status
./scripts/deploy_dev.sh --logs           # Tail API + web logs
```

**Branch Safety**: The script warns if deploying from a branch other than `main` (gives 5-second cancel window). Use `--branch <name>` to automatically switch branches before deploying. The current branch is displayed in startup and ready headers to prevent confusion.

### Production Docker stack (`deploy_prod.sh`)
Runs the full Docker stack (API + Web + DB + Redis) on http://localhost:80:
```bash
./scripts/deploy_prod.sh                  # Start Docker stack (cached images)
./scripts/deploy_prod.sh --rebuild        # Rebuild images then start
./scripts/deploy_prod.sh --fresh          # Reset DB, new admin password, rebuild
./scripts/deploy_prod.sh --reset-password # Reset admin password (no data loss)
./scripts/deploy_prod.sh --down           # Stop all containers
./scripts/deploy_prod.sh --status         # Show container status
./scripts/deploy_prod.sh --logs           # Tail API logs
```

**Admin password reset policy:** Use `--reset-password` on either script to reset the admin password without wiping data. Use `--fresh` to wipe the DB entirely and generate a new password. Both update `.env` `ADMIN_PASSWORD` so the password stays in sync across dev/prod. Never manually update password hashes in the database.

**Data persistence (`/data` volume):** The `/data` Docker volume persists app settings (Blizzard API keys, Discord OAuth config, etc.) across container rebuilds. Integration credentials are stored in the `app_settings` DB table. When modifying deploy scripts or Docker configuration, **never remove the `/data` volume** during `--rebuild` or normal starts — integration secrets must survive routine rebuilds so the user doesn't have to re-enter API keys. Only `--fresh` performs a full wipe (including `/data`).

## Artifacts Folders

- **`implementation-artifacts/`** — Implementation outputs: screenshots, GIFs, videos, test results, and implementation documentation (e.g. ticket write-ups, smoke-test logs)
- **`planning-artifacts/`** — Planning documentation: UX mockups, design specs, wireframes, and planning-related materials

All captured media (screenshots, GIFs, screen recordings) should be saved to `implementation-artifacts/screenshots/` or an appropriate subfolder within `implementation-artifacts/`.

## Linear Integration (MANDATORY)

**Project:** Raid Ledger (ID: `1bc39f98-abaa-4d85-912f-ba62c8da1532`)
**Team:** Roknua's projects
**Scope:** Only modify issues in the Raid Ledger project. Never touch other Linear projects.

### Source of Truth

**Linear is the single source of truth for all story/issue status.** Local files are lightweight caches:

| File | Role | Regenerated by |
|------|------|----------------|
| `planning-artifacts/sprint-status.yaml` | Project status + active sprint cache (Linear mirror) | `/init` |
| `task.md` | Session working doc with checkboxes | `/init` (overwritten each session) |

**Never hand-edit sprint-status.yaml** — it is overwritten from Linear by `/init`.
**task.md is ephemeral** — it tracks the current session only.

### Session Workflow
1. **`/init`** pulls all issues from Linear → regenerates both local files
2. **During session:** Update `task.md` checkboxes as you work (`[x]` = done, `[/]` = in progress)
3. **On story completion:** Update Linear status + add summary comment (see "On Story Completion")
4. **Before `/clear`:** Verify all worked-on stories have been updated in Linear

### On Every Commit
When code is committed:
1. Update `task.md` to reflect the work done (mark checkboxes)
2. **Update the relevant Linear story status immediately** — move to "In Progress" or "Done" as appropriate using the Linear MCP tools.

### On Story Completion
When a story (ROK-XXX) is finished — all ACs met, code committed:
1. **Dev teammate** messages the lead that implementation is complete
2. **Operator** tests locally on the feature branch with `deploy_dev.sh --branch rok-XXX`
3. **Lead** pushes the branch, creates a GitHub PR (`gh pr create --base main`), and enables auto-merge (`gh pr merge --auto --squash`)
4. **Lead** posts PR URL as a Linear comment on the issue, updates Linear → "In Review"
5. CI passes → PR auto-merges to `main`
6. **Lead** updates Linear → "Done" with a summary comment:
   - Key files changed
   - Commit SHA(s) and PR number
   - Any notable decisions or deviations from the original spec
7. Update `task.md` checkbox to `[x]`

This replaces the need to invoke `/handover` for Linear sync. Agents document their work as they go, not as a separate ceremony.

### Before /clear
Before a session is cleared with `/clear`, you MUST:
1. Check if any stories were worked on (check `task.md` for `[x]` or `[/]` items)
2. Ensure their statuses are updated in Linear with summary comments
3. Confirm the updates were made before proceeding with the clear

### Status Mapping
| task.md | Linear Status | sprint-status.yaml | Meaning |
|---------|---------------|-------------------|---------|
| `[x]` | Done | `done` | PR merged to main |
| `[/]` | In Progress | `in-progress` | Dev agent implementing |
| `[ ]` | Todo | `ready-for-dev` | Ready for dispatch |
| `[ ]` | Dispatch Ready | `dispatch-ready` | Spec complete, queued |
| *(not listed)* | Backlog | `backlog` | Not yet planned |
| *(not listed)* | In Review | `review` | PR created, awaiting CI + operator approval |
| *(not listed)* | Code Review | `code-review` | Operator approved, awaiting code review agent |
| *(not listed)* | Changes Requested | `changes-requested` | Operator or reviewer found issues |
| *(not listed)* | Canceled | `deprecated` | Dropped |

### Status Flow
```
Dispatch Ready → In Progress → In Review (PR created, auto-merge enabled)
  → operator tests locally on feature branch →
    Changes Requested (issues found) → In Progress (dev fixes) → In Review
    Code Review (operator approved) → reviewer agent reviews →
      Changes Requested (reviewer issues) → In Progress → In Review
      Done (CI passes, PR auto-merges to main)
```

## Agent Teams (Parallel Development)

This repo uses Claude Code's Agent Teams feature for parallel story implementation via git worktrees.

### Architecture

```
Operator (human)
  └─ Lead (main worktree — orchestrates, creates PRs, syncs Linear)
       ├─ Dev Teammate 1 (worktree ../Raid-Ledger--rok-XXX)
       ├─ Dev Teammate 2 (worktree ../Raid-Ledger--rok-YYY)
       └─ Reviewer Teammate (main worktree — code-reviews PRs)
```

### Team Roles

| Role | Model | Working Directory | Responsibilities |
|------|-------|-------------------|------------------|
| **Lead** | Opus 4.6 | `Raid-Ledger/` (main) | Orchestrate, create PRs with auto-merge, sync Linear |
| **Dev 1-3** | Opus 4.6 | `Raid-Ledger--rok-*/` | Implement stories, commit, message lead |
| **Reviewer** | Sonnet 4.5 | `Raid-Ledger/` (main) | Code-review PRs via `gh`, approve/request changes |

- Lead runs in delegate mode (coordination only)
- Dev teammates do NOT push, create PRs, or access Linear — lead handles all external ops
- Reviewer does NOT implement code or merge PRs — only reviews
- Max 2-3 dev teammates at once

### Worktree Convention

Each parallel story gets its own worktree as a sibling directory:
```
/Users/sdodge/Documents/Projects/
  Raid-Ledger/                    # Main worktree (lead)
  Raid-Ledger--rok-219/           # Dev teammate worktree
  Raid-Ledger--rok-274/           # Dev teammate worktree
```

Setup per story:
```bash
git worktree add ../Raid-Ledger--rok-<num> -b rok-<num>-<short-name> main
cd ../Raid-Ledger--rok-<num> && npm install --legacy-peer-deps && npm run build -w packages/contract
```

Cleanup after PR merge:
```bash
git worktree remove ../Raid-Ledger--rok-<num>
git branch -d rok-<num>-<short-name>
```

### PR Workflow

```
1. Teammate completes story → messages lead
2. Build agent validates CI locally → pushes branch
3. Lead creates PR with auto-merge enabled (Linear → "In Review")
4. Operator tests locally: deploy_dev.sh --branch rok-<num>-<short-name>
5. Reviewer code-reviews PR via gh pr review
6. CI passes → PR auto-merges to main → Linear → "Done"
   OR changes requested → Linear → "Changes Requested" → teammate fixes
```

### Parallelism Safety

**Can run in parallel:** Stories touching different domains (e.g., one api-only, one web-only), stories in separate modules.

**Must be sequential:** Stories modifying `packages/contract/` (shared dependency), stories generating database migrations (number collision), stories touching the same files.

**Contract protocol:** If a story needs contract changes, it runs first. After merge, lead broadcasts: "Contract updated — rebase your branches."

**Migration protocol:** Never run two migration-generating stories in parallel. After merge, run `./scripts/fix-migration-order.sh`.

## Compact Instructions

When compacting context during a session, preserve the following:
- Current task/story being worked on (ROK-XXX identifier and description)
- All commit SHAs produced during the session
- Any phase results from in-progress skill execution (backup, etc.)
- File paths that were recently modified
- **Do NOT re-read `task.md` or `sprint-status.yaml` after compaction** — they are caches and your in-memory state is fresher

## Environment Setup

Copy `.env.example` to `.env` in the project root. Required: `DATABASE_URL`, `JWT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `CLIENT_URL`, `CORS_ORIGIN`. IGDB keys are optional (game data is pre-seeded).