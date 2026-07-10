---
project_name: 'Raid-Ledger'
user_name: 'Roknua'
date: '2026-02-02'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 22
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Core Technologies
- **Backend:** NestJS 11.x, TypeScript 6.0.x
- **Frontend:** React 19.x, Vite 8.x, TypeScript ~6.0.x
- **Database:** PostgreSQL 16 (pgvector image), Drizzle ORM
- **Infrastructure:** Docker Compose
- **Shared:** `packages/contract` (Zod 4.x)

### Key Dependencies
- **Validation:** `zod` (Single Source of Truth)
- **State Management:** TanStack Query (Server), Zustand (Client)
- **Styling:** TailwindCSS 4 + hand-rolled component library in `web/src/components/ui` (no Shadcn/UI)
- **Background Jobs:** BullMQ on Redis (embed sync, notification dispatch/buffering) — Redis is a hard runtime dependency in both topologies
- **Time Management:** Postgres `tsrange` (Critical for Availability)

---

## Critical Implementation Rules

### Language-Specific Rules (TypeScript)
- **Zod-First Validation:** You MUST use Zod schemas for all data validation. 
- **Shared Contract:** All API DTOs and Frontend Types MUST be derived from `packages/contract`. DO NOT duplicate types manually.
- **Strict Mode:** TypeScript strict mode is enabled. No `any`.

### Framework-Specific Rules
- **Methodology:** "DIY Clean Start" - No opinionated boilerplates.
- **NestJS:** Validate request bodies/queries by calling the shared contract Zod schemas directly in controllers (`const dto = SomeSchema.parse(body)`). There is no `nestjs-zod` and no OpenAPI/Swagger generation.
- **React:** Forms are hand-rolled controlled components validated against the shared contract Zod schemas — `react-hook-form` is not used.
- **Monorepo:** Use `npm workspaces`. Run commands with `-w` (e.g., `npm run test -w api`).

### Testing Rules
- **Backend:** Jest (`npm run test -w api`)
- **Frontend:** Vitest (`npm run test -w web`)
- **E2E (UI):** Playwright smoke tests (`npx playwright test`, desktop + mobile — root `playwright.config.ts`)
- **E2E (Discord):** companion-bot smoke suite (`cd tools/test-bot && npm run smoke`)
- **Structure:** Implementation-adjacent spec files (e.g., `feature.service.spec.ts` next to `feature.service.ts`).
- **Quality Standards:** See [TESTING.md](./TESTING.md) for patterns, anti-patterns, and exemplary references

### Code Quality & Style Rules
- **Formatting:** Prettier is authoritative.
- **Linting:** ESLint with standard presets.
- **File Size Limits:**
  - **Max 300 lines** per source file (`error`, skipBlankLines + skipComments)
  - **Max 30 lines** per function (`warn` — planned upgrade to `error`; test files relaxed to 60)
  - **Max 750 lines** for test files (`error`) (`*.spec.ts`, `*.test.tsx`)
  - Migration files are exempt from both limits
  - No blanket `/* eslint-disable */` — must specify rules
- **Design small from the start** — plan focused modules, extract helpers/sub-services/child components proactively. Do not write large files and refactor after.
- **Naming:**
  - Files: `kebab-case` (e.g., `user-profile.tsx`)
  - Helper files: `{module}.helpers.ts` (standalone functions extracted from services)
  - Handler files: `{listener-name}.handlers.ts` (extracted listener methods)
  - Test helper files: `{name}.spec-helpers.ts` (shared test setup)
  - Classes: `PascalCase`
  - Variables/Properties: `camelCase`
  - Database Columns: `snake_case` (Explicitly mapped in Drizzle)

### Development Workflow Rules
- **Build Order:** You MUST build `packages/contract` (`npm run build -w packages/contract`) before building `api` or `web`.
- **Database Changes:** Generate migrations with Drizzle Kit (`npm run db:generate -w api`); RUN them via the programmatic migrator (`npm run db:migrate -w api` → `api/src/scripts/run-migrations.ts`), never `drizzle-kit migrate` (it silently swallows SQL errors — ROK-1343). NEVER modify schema manually.
- **Docker:** DB + Redis run in Docker; local dev is `./scripts/deploy_dev.sh` (native API watch mode + Vite dev server). Full-stack `docker-compose up` is for CI/test only (the `web` service is behind the `test` profile).

### Deployment Topologies (CRITICAL — two different Docker configurations)

| Aspect | Dev/CI (`docker-compose.yml`) | Prod (`Dockerfile.allinone`) |
|--------|-------------------------------|------------------------------|
| Image | `api/Dockerfile` | `Dockerfile.allinone` |
| DB | Separate PostgreSQL container | Embedded PostgreSQL |
| Redis | Separate container (TCP `redis:6379`) | Embedded (Unix socket `/tmp/redis.sock`, perms `770`) |
| Web | Separate Nginx container | Embedded Nginx |
| Process mgmt | Docker Compose | Supervisor |
| API user | `nestjs` (uid 1001) | `app` (uid 1001) |
| Entrypoint | `api/scripts/docker-entrypoint.sh` (runs as `nestjs`) | Same entrypoint, called by `start-api.sh` (runs as `app` via supervisor's `[program:api] user=app`; only the container-level `/app/entrypoint.sh` runs as root) |

**Key files:** `Dockerfile.allinone`, `api/Dockerfile`, `api/scripts/docker-entrypoint.sh`, `nginx/monolith.conf.template`
**Deployment:** Watchtower auto-pulls GHCR images daily at 5 AM on the Synology NAS.

### Critical Don't-Miss Rules
- **Constraint:** The Availability Domain uses `tsrange` for matchmaking. Do NOT use simple start/end timestamps.
- **Constraint:** Discord Bot is a Module inside `api`, NOT a separate service.
- **Constraint:** `packages/contract` is a HARD boundary. Changes here require broad verification.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-07-10
