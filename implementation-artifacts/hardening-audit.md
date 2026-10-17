# Pre-Launch Codebase Hardening Audit

**Date:** 2026-03-18
**Story:** ROK-278
**Auditor:** Automated + manual review

---

## Summary

The Raid Ledger codebase is in strong shape for a pre-launch state. The architecture follows established patterns consistently, all API inputs are Zod-validated, SQL injection is structurally prevented through Drizzle ORM, and the security posture is solid. No critical blocking issues were found. The findings below are improvements to harden the codebase further.

**Totals by severity:**
- **Critical:** 0
- **High:** 4
- **Medium:** 9
- **Low:** 7

---

## Critical Findings

_None found._

---

## High Findings

### H-1: Missing `onDelete` cascade on several FK relationships (orphaned data risk)

**Severity:** High
**Category:** Data Integrity

Several foreign key references lack an `onDelete` policy, defaulting to PostgreSQL's `NO ACTION` (which prevents parent deletion or leaves orphaned rows if constraints are deferred).

| File | Line | Column | FK Target | Recommended Action |
|------|------|--------|-----------|-------------------|
| `api/src/drizzle/schema/availability.ts` | 28 | `userId` | `users.id` | Add `{ onDelete: 'cascade' }` |
| `api/src/drizzle/schema/availability.ts` | 39 | `gameId` | `games.id` | Add `{ onDelete: 'set null' }` |
| `api/src/drizzle/schema/availability.ts` | 41 | `sourceEventId` | `events.id` | Add `{ onDelete: 'set null' }` |
| `api/src/drizzle/schema/events.ts` | 56 | `creatorId` | `users.id` | Add `{ onDelete: 'cascade' }` or `'set null'` |
| `api/src/drizzle/schema/sessions.ts` | 9 | `userId` | `users.id` | Add `{ onDelete: 'cascade' }` |
| `api/src/drizzle/schema/event-templates.ts` | 14 | `creatorId` | `users.id` | Add `{ onDelete: 'cascade' }` |
| `api/src/drizzle/schema/pug-slots.ts` | 59 | `claimedByUserId` | `users.id` | Add `{ onDelete: 'set null' }` |

**Impact:** When a user is deleted (via self-delete ROK-405 or admin removal), their availability records, sessions, templates, and pug claims will fail to clean up properly if the delete isn't wrapped in manual cleanup logic. The `events.creatorId` reference is the most impactful -- deleting a user who created events will fail at the DB level.

**Fix:** Add a migration to add the appropriate `ON DELETE` rules. Use `CASCADE` for ownership data (sessions, templates, availability) and `SET NULL` for reference data (pug claims, event creator).

### H-2: No JWT token revocation mechanism

**Severity:** High
**Category:** Security

The JWT strategy (`api/src/auth/jwt.strategy.ts`, line 22-27) validates tokens solely by signature and expiry. There is no blocklist or revocation check. If a user is deleted, demoted, or if their session is compromised, existing JWTs remain valid until they expire (24 hours per `api/src/auth/auth.module.ts`, line 41).

The auth user cache (`auth-user-cache`) mitigates role changes somewhat (stale role data is refreshed on cache miss), but:
- Deleted users are checked against DB on every cache miss, which is correct
- Compromised tokens cannot be invalidated early

**Fix:** Consider adding a Redis-based token blocklist that checks on each JWT validation. When a user is deleted or their role changes, add their token JTI (or user ID + issued-at) to the blocklist. This is a standard pattern for stateless JWT architectures.

### H-3: Redis connection has no error handling or reconnection strategy

**Severity:** High
**Category:** Resilience

The Redis module (`api/src/redis/redis.module.ts`, lines 17-24) creates a raw ioredis instance with no error handler, retry strategy, or connection health monitoring. If Redis goes down:
- Rate limiting will throw unhandled errors (ThrottlerGuard)
- Avatar upload rate checks will fail
- IGDB search caching will fail
- Auth code exchange will fail

ioredis has built-in reconnection, but unhandled `error` events on the client will crash the process in some Node.js versions.

**Fix:** Add `retryStrategy`, `maxRetriesPerRequest`, and an `.on('error', ...)` handler to the Redis client factory. Consider a `lazyConnect: true` option so the app starts even if Redis is temporarily unavailable.

### H-4: `GET /events/:id/aggregate-game-time` and `GET /events/:id/ad-hoc-roster` lack auth guards

**Severity:** High
**Category:** Security

In `api/src/events/events.controller.ts`:
- `getAggregateGameTime` (line 138) has no `@UseGuards` -- exposes aggregate game time data for any event to unauthenticated users.

In `api/src/events/events-attendance.controller.ts`:
- `getAdHocRoster` (line 79) has no `@UseGuards` -- exposes ad-hoc roster (voice channel participant list) without authentication.

While these are not highly sensitive, they expose player data (game time availability, voice session participation) that should at minimum require authentication or use `OptionalJwtGuard`.

**Fix:** Add `@UseGuards(OptionalJwtGuard)` or `@UseGuards(AuthGuard('jwt'))` to these endpoints.

---

## Medium Findings

### M-1: Analytics controller uses inline role checks instead of guards

**Severity:** Medium
**Category:** Code Quality / Security

`api/src/events/analytics.controller.ts` (lines 62-119) uses `AuthGuard('jwt')` at the method level but checks `isOperatorOrAdmin(req.user.role)` manually inside each handler, throwing `ForbiddenException`. This is inconsistent with the rest of the codebase which uses `OperatorGuard` or `AdminGuard` as decorators.

**Fix:** Replace the three manual role checks with `@UseGuards(AuthGuard('jwt'), OperatorGuard)` at the class level.

### M-2: Duplicated `handleValidationError` and `isOperatorOrAdmin` helpers

**Severity:** Medium
**Category:** Code Quality

The `handleValidationError` function is defined in three separate places:
1. `api/src/events/controller.helpers.ts` (shared)
2. `api/src/events/templates.controller.ts` (line 28, local copy)
3. `api/src/events/analytics.controller.ts` (line 39, local copy)

Similarly, `isOperatorOrAdmin` is defined locally in `analytics.controller.ts` (line 32) despite being exported from `controller.helpers.ts`.

**Fix:** Remove the local copies in `templates.controller.ts` and `analytics.controller.ts` and import from `controller.helpers.ts`.

### M-3: `AuthenticatedRequest` interface duplicated across many controllers

**Severity:** Medium
**Category:** Code Quality

The `AuthenticatedRequest` interface is defined locally in at least 10 controllers with varying shapes. Some include `discordId`, some include `impersonatedBy`, some have only `id` and `role`.

**Fix:** Create a shared interface in `api/src/auth/types.ts` with the full shape and import it everywhere.

### M-4: `GET /admin/branding` is public (no auth guard on GET method)

**Severity:** Medium
**Category:** Security

`api/src/admin/branding.controller.ts` (line 101): The `getBranding()` GET method has no auth guard, despite the controller path being `admin/branding`. The comment says "Public endpoint - login page needs branding before auth" which is a valid reason, but it means the `admin/` prefix is misleading. Other admin endpoints on this controller correctly require `AuthGuard('jwt'), AdminGuard`.

**Fix:** This is intentional by design (branding shown on login page), but consider moving the public branding endpoint to the `SystemController` alongside `getStatus()` to avoid confusion, or add a comment on the class-level noting the mixed auth model.

### M-5: Unused dependencies flagged by depcheck

**Severity:** Medium
**Category:** Code Quality

**API unused devDependencies:**
- `@eslint/eslintrc`
- `@nestjs/schematics`
- `@types/jest`
- `source-map-support`
- `testcontainers`
- `ts-loader`
- `tsconfig-paths`

**Web unused devDependencies:**
- `@vitest/coverage-v8`
- `axe-core`
- `tailwindcss`

Note: Some of these may be indirect dependencies (e.g., `tailwindcss` used via PostCSS config, `@vitest/coverage-v8` used via CLI). Verify before removing.

**Fix:** Audit each flagged dependency and remove genuinely unused ones.

### M-6: `CORS_ORIGIN=auto` allows any origin in production

**Severity:** Medium
**Category:** Security

`api/src/main.ts` (lines 43-44): When `CORS_ORIGIN` is set to `auto`, the `buildCorsOriginFn` function returns `callback(null, true)` for ANY origin. While `validateCorsConfig` prevents `*` in production, it does not prevent `auto`. If deployed with `CORS_ORIGIN=auto` in production, all origins are accepted.

**Fix:** Add `auto` to the production validation check, or document that `auto` is only safe for single-origin reverse proxy deployments (like the Synology NAS behind nginx where the same origin serves both frontend and API).

### M-7: Body parser limit of 8MB may be excessive

**Severity:** Medium
**Category:** Security

`api/src/main.ts` (line 112): `app.useBodyParser('json', { limit: '8mb' })` allows 8MB JSON payloads. Given that the largest expected payload is an event creation with content instances, 8MB is significantly larger than needed. This could be exploited for memory pressure attacks.

**Fix:** Reduce to 1MB or 2MB. File uploads (avatars, logos) use multipart form data with their own size limits and are not affected by the JSON body parser limit.

### M-8: `events.gameId` FK lacks index documentation clarity

**Severity:** Medium
**Category:** Data Integrity

The events table has an index on `gameId` (line 111), but the `gameId` column references `games.id` without an `onDelete` policy (line 54). If a game is deleted from the games table, events referencing it will block the deletion.

**Fix:** Add `{ onDelete: 'set null' }` to `events.gameId` so that deleting a game sets the event's game to null rather than blocking the operation.

### M-9: 574 ESLint warnings in API, 81 in web (all `max-lines-per-function`)

**Severity:** Medium
**Category:** Code Quality

While these are `warn` level (not blocking), the CLAUDE.md states these will be upgraded to `error`. Nearly all warnings are in test files (function-too-long) which have a relaxed limit of 60 lines. The few source file violations are:
- `api/src/steam/steam-wishlist.helpers.ts:123` (32 lines, limit 30)
- `api/src/system/system.controller.ts:44` (31 lines, limit 30)
- `api/src/users/game-time-composite.helpers.ts:182,241` (40 and 44 lines)
- `api/src/users/users.controller.ts:68` (32 lines, limit 30)
- Several web component functions exceeding 30 lines

**Fix:** Refactor the 6-8 source file violations to stay under 30 lines before upgrading the rule to `error`.

---

## Low Findings

### L-1: `as any` usage in test files (standard but worth tracking)

**Severity:** Low
**Category:** Code Quality

Found ~60 instances of `as any` across test files. These are typical test patterns (mocking DB objects, casting partial types), and zero `as any` in non-test source files. This is healthy.

**Action:** No action needed. Test files have inherently weaker typing due to mocking.

### L-2: `localhost` fallback URLs scattered across source code

**Severity:** Low
**Category:** Configuration

Several services fall back to `http://localhost:5173` when `CLIENT_URL` is not set:
- `api/src/events/og-meta.service.ts:24`
- `api/src/notifications/discord-notification-embed.service.ts:174`

This is safe (only used when env var is missing, which won't happen in production), but centralizing the fallback into a shared config helper would be cleaner.

**Fix:** Extract to a utility like `getClientUrlWithFallback()` in the settings service.

### L-3: `event_types` table lacks an index on `gameId`

**Severity:** Low
**Category:** Performance

`api/src/drizzle/schema/games.ts` (line 106): The `event_types` table has a `gameId` FK but no standalone index. Queries filtering event types by game will do a sequential scan on this table. Given the small expected size (<100 rows), this is not impactful now but should be added before the table grows.

### L-4: `game_interests` table lacks an index on `gameId`

**Severity:** Low
**Category:** Performance

`api/src/drizzle/schema/game-interests.ts`: The `gameId` column is frequently queried (want-to-play counts, community interest) but has no standalone index. The unique constraint on `(userId, gameId, source)` provides indexed access when all three columns are used, but queries filtering only by `gameId` (e.g., count interested users for a game) will not use it efficiently.

### L-5: `availability` table only indexes `userId`

**Severity:** Low
**Category:** Performance

`api/src/drizzle/schema/availability.ts`: The table has an index on `userId` but none on `timeRange` (GiST), `gameId`, or `sourceEventId`. For the matchmaking use case (finding overlapping availability windows), a GiST index on `timeRange` would significantly improve performance as the user base grows.

**Fix:** Add `index('idx_availability_time_range').using('gist', table.timeRange)` (requires custom migration since Drizzle's DSL may not support GiST indexes natively).

### L-6: Frontend accessibility is present but coverage is uneven

**Severity:** Low
**Category:** Accessibility

Found 309 ARIA/role/keyboard attributes across 120 `.tsx` files. Key observations:
- Top-level `ErrorBoundary` with Sentry integration is excellent
- Modal component has proper `aria-modal`, `role="dialog"`, keyboard trap
- `LiveRegionProvider` exists for screen reader announcements
- Bottom sheet has `aria-expanded`
- Calendar and roster components have `role` attributes

Areas that could use improvement:
- Game cards lack `aria-label` descriptions
- Some interactive elements may rely on `:hover` without keyboard equivalents
- No skip-to-content link in the layout

**Action:** Consider a focused accessibility pass after launch using `axe-core` automated testing (the dependency is already installed).

### L-7: No explicit Content-Security-Policy header

**Severity:** Low
**Category:** Security

While `helmet` is configured (`api/src/main.ts:113`), the default helmet CSP may be too permissive or conflict with the SPA's needs. The current configuration only overrides `crossOriginResourcePolicy`. A tailored CSP would prevent XSS even if an attacker manages to inject content.

**Fix:** Configure a specific CSP policy in the helmet options that allows the known script and style sources (self, Vite dev server in development, CDN origins if any).

---

## Automated Check Results

### TypeScript Compilation
- **API:** `npx tsc --noEmit -p api/tsconfig.json` -- **PASS** (0 errors)
- **Web:** `npx tsc --noEmit -p web/tsconfig.json` -- **PASS** (0 errors)

### ESLint
- **API:** 0 errors, 574 warnings (all `max-lines-per-function` in test/source files)
- **Web:** 0 errors, 81 warnings (all `max-lines-per-function` in test/source files)
- **Contract:** lint passed (no issues)

### Dependency Check (depcheck)
- **API:** 7 unused devDependencies, 4 false-positive missing dependencies
- **Web:** 3 unused devDependencies, 2 false-positive missing dependencies

### Security Posture Summary
- **Auth guards:** All 36 controllers reviewed; all protected routes have appropriate guards
- **RBAC:** AdminGuard, OperatorGuard, and PluginActiveGuard properly implemented
- **SQL injection:** Zero risk -- all queries use Drizzle ORM with parameterized `sql` tagged templates
- **XSS:** OG meta service has proper HTML escaping; no server-rendered user content elsewhere
- **CORS:** Properly validated; production requires explicit origin
- **File uploads:** Avatar and logo uploads have magic byte validation, size limits, and type filtering
- **Rate limiting:** Global ThrottlerGuard applied; auth endpoints have stricter `@RateLimit('auth')`
- **Password hashing:** bcrypt with 12 salt rounds
- **Secrets:** No credentials in committed code; `.env.example` files contain only placeholders
- **Helmet:** Applied for HTTP security headers
- **Compression:** Enabled with 1KB threshold

---

## Audit Scope Checklist

| Area | Status | Notes |
|------|--------|-------|
| Auth guards on all controllers | DONE | 2 endpoints missing guards (H-4) |
| RBAC enforcement | DONE | AdminGuard and OperatorGuard correctly implemented |
| SQL injection | DONE | Zero risk via Drizzle ORM |
| XSS prevention | DONE | HTML escaping in OG meta; no other SSR content |
| JWT handling | DONE | Token revocation gap (H-2) |
| CORS configuration | DONE | `auto` mode concern (M-6) |
| File upload security | DONE | Magic bytes + size limits + type filtering |
| Secrets in code | DONE | Clean -- only `.env.example` placeholders |
| Error handling patterns | DONE | Consistent Zod validation; empty catches are non-critical |
| Redis resilience | DONE | Missing error handler (H-3) |
| DB connection pool | DONE | Managed by Drizzle/postgres.js with defaults |
| Input validation | DONE | Zod schemas on all mutation endpoints |
| Missing DB indexes | DONE | 3 low-priority indexes recommended |
| FK cascade rules | DONE | 7 FKs missing `onDelete` policy (H-1) |
| Migration safety | DONE | All migrations are additive DDL |
| Dead code / unused deps | DONE | depcheck flagged unused devDependencies (M-5) |
| `any` types | DONE | Zero in source files; ~60 in tests (acceptable) |
| Duplicated logic | DONE | 3 cases of duplicated helpers (M-2, M-3) |
| Test coverage gaps | DONE | Core paths covered; 574 lint warnings in test sizes |
| Hardcoded values | DONE | `localhost` fallbacks are safe (L-2) |
| Frontend error boundaries | DONE | Top-level Sentry ErrorBoundary + chunk retry |
| Frontend loading/error states | DONE | 690 occurrences across 93 page files |
| Frontend accessibility | DONE | Present but uneven (L-6) |
| Frontend memory leaks | DONE | TanStack Query manages cache; no manual listeners found |
