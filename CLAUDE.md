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

- **Branch-per-story** — Multiple agents may work in this repo concurrently. **Always** create a new branch from `main` when starting a new story or feature (e.g., `git checkout -b rok-123-feature-name`). Commit work to the feature branch. When the story is complete, merge the feature branch into `main` (`git checkout main && git merge <branch>`). Never commit directly to `main` for story/feature work.
- **Zod-first validation** — All data validation uses Zod schemas from the contract package
- **TypeScript strict mode** — No `any` allowed in either api or web
- **Naming conventions** — Files: `kebab-case`, Classes: `PascalCase`, Variables: `camelCase`, DB columns: `snake_case` (mapped in Drizzle)
- **Availability domain** — Uses PostgreSQL `tsrange` for scheduling/matchmaking, not simple start/end timestamps
- **Discord Bot** — Module inside `api/`, not a separate service
- **Database schema changes** — Use Drizzle Kit migrations only, never modify schema manually
- **npm config** — `.npmrc` has `legacy-peer-deps=true` for NestJS compatibility

## Deploy Scripts

Both scripts share the same Docker DB volume and `.env` `ADMIN_PASSWORD` — the admin password never desyncs between dev and prod.

### Local development (`deploy_dev.sh`)
Runs native API (watch mode) + Vite dev server against Docker DB + Redis:
```bash
./scripts/deploy_dev.sh                  # Start dev environment
./scripts/deploy_dev.sh --rebuild        # Rebuild contract package, then start
./scripts/deploy_dev.sh --fresh          # Reset DB, new admin password, restart
./scripts/deploy_dev.sh --reset-password # Reset admin password (no data loss)
./scripts/deploy_dev.sh --down           # Stop everything
./scripts/deploy_dev.sh --status         # Show process/container status
./scripts/deploy_dev.sh --logs           # Tail API + web logs
```

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
| `planning-artifacts/sprint-status.yaml` | Full project status cache (Linear mirror) | `/init` and `/handover` |
| `task.md` | Session working doc with checkboxes | `/init` (overwritten each session) |

**Never hand-edit sprint-status.yaml** — it is overwritten from Linear by `/init` and `/handover`.
**task.md is ephemeral** — it tracks the current session only. Checkboxes (`[x]`, `[/]`) drive the `/handover` push to Linear.

### Session Workflow
1. **`/init`** pulls all issues from Linear → regenerates both local files
2. **During session:** Update `task.md` checkboxes as you work (`[x]` = done, `[/]` = in progress)
3. **`/handover`** pushes `task.md` changes to Linear → regenerates `sprint-status.yaml` from Linear

### On Every Commit
When code is committed:
1. Update `task.md` to reflect the work done (mark checkboxes)
2. **Update the relevant Linear story status immediately** — move to "In Progress" or "Done" as appropriate using the Linear MCP tools. Do not defer status updates to `/handover`.

### Before /clear
Before a session is cleared with `/clear`, you MUST:
1. Check if any stories were worked on (check `task.md` for `[x]` or `[/]` items)
2. Push their statuses to Linear directly (don't rely on `/handover`)
3. Confirm the updates were made before proceeding with the clear

### Status Mapping
| task.md | Linear Status | sprint-status.yaml |
|---------|---------------|-------------------|
| `[x]` | Done | `done` |
| `[/]` | In Progress | `in-progress` |
| `[ ]` | Todo | `ready-for-dev` |
| *(not listed)* | Backlog | `backlog` |
| *(not listed)* | In Review | `review` |
| *(not listed)* | Canceled | `deprecated` |

## Compact Instructions

When compacting context during a session, preserve the following:
- Current task/story being worked on (ROK-XXX identifier and description)
- All commit SHAs produced during the session
- Any phase results from in-progress skill execution (handover, backup, etc.)
- The path `/tmp/handover-snapshot.md` if a handover is in progress — re-read this file after compaction to recover full handover state
- File paths that were recently modified
- **Do NOT re-read `task.md` or `sprint-status.yaml` after compaction** — they are caches and your in-memory state is fresher

## Environment Setup

Copy `.env.example` to `.env` in the project root. Required: `DATABASE_URL`, `JWT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `CLIENT_URL`, `CORS_ORIGIN`. IGDB keys are optional (game data is pre-seeded).