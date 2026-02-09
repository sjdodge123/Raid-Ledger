---
name: db-migrate
description: Run database migrations and optionally seed data
disable-model-invocation: true
argument-hint: "[generate|migrate|seed-games|seed-admin|all]"
allowed-tools: "Bash(npm run db:*), Bash(npm run *:dev*)"
---

# Database Migration

Manage Drizzle ORM database migrations and seeds for the API.

## Based on `$ARGUMENTS`:

- **generate** — Run `npm run db:generate -w api` to generate migrations from schema changes
- **migrate** — Run `npm run db:migrate -w api` to apply pending migrations
- **seed-games** — Run `npm run db:seed:games -w api` to seed game registry data
- **seed-admin** — Run `npm run db:seed:admin -w api` to seed admin user
- **all** — Run migrate, then seed-games, then seed-admin in sequence
- **(no argument)** — Run `npm run db:migrate -w api` (apply migrations only)

Always display the output so the user can see what was applied.
