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
- **Backend:** NestJS 11.x, TypeScript 5.7.x
- **Frontend:** React 19.x, Vite 7.x, TypeScript ~5.9.x
- **Database:** PostgreSQL (Latest Stable), Drizzle ORM
- **Infrastructure:** Docker Compose
- **Shared:** `packages/contract` (Zod 3.22.4)

### Key Dependencies
- **Validation:** `zod` (Single Source of Truth)
- **State Management:** TanStack Query (Server), Zustand (Client)
- **Styling:** TailwindCSS + Shadcn/UI
- **Time Management:** Postgres `tsrange` (Critical for Availability)

---

## Critical Implementation Rules

### Language-Specific Rules (TypeScript)
- **Zod-First Validation:** You MUST use Zod schemas for all data validation. 
- **Shared Contract:** All API DTOs and Frontend Types MUST be derived from `packages/contract`. DO NOT duplicate types manually.
- **Strict Mode:** TypeScript strict mode is enabled. No `any`.

### Framework-Specific Rules
- **Methodology:** "DIY Clean Start" - No opinionated boilerplates.
- **NestJS:** Use `nestjs-zod` to auto-generate OpenAPI/Swagger.
- **React:** Use `react-hook-form` resolved with Zod schemas. 
- **Monorepo:** Use `npm workspaces`. Run commands with `-w` (e.g., `npm run test -w api`).

### Testing Rules
- **Backend:** Jest (`npm run test -w api`)
- **Frontend:** Vitest (`npm run test -w web`)
- **Structure:** Implementation-adjacent spec files (e.g., `feature.service.spec.ts` next to `feature.service.ts`).
- **Quality Standards:** See [TESTING.md](./TESTING.md) for patterns, anti-patterns, and exemplary references

### Code Quality & Style Rules
- **Formatting:** Prettier is authoritative.
- **Linting:** ESLint with standard presets.
- **File Size Limits (strict `error`):**
  - **Max 300 lines** per source file (`skipBlankLines + skipComments`)
  - **Max 30 lines** per function (`skipBlankLines + skipComments`)
  - **Max 750 lines** for test files (`*.spec.ts`, `*.test.tsx`)
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
- **Database Changes:** Use Drizzle Kit for migrations. NEVER modify schema manually.
- **Docker:** All services run via `docker-compose up`.

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

Last Updated: 2026-03-06
