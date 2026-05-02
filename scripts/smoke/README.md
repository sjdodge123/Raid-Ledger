# Playwright smoke tests — fixture requirements

This file documents the dev-DB state each smoke spec assumes, the reset/seed
endpoint it calls in `beforeAll`, and any per-worker scoping in use. Read this
before adding a new spec or diagnosing a "fails on first run, passes after
reset-to-seed" failure (ROK-1070).

## Setup

1. `./scripts/deploy_dev.sh --ci --rebuild` — brings up Docker Postgres + Redis,
   runs migrations, seeds demo data, starts API + web in watch mode.
2. `npx playwright test` — runs ALL specs across `desktop` + `mobile` projects.
   Smoke tests are sequential within a project (`fullyParallel: false`); the two
   projects run in parallel.

If a spec fails on a clean dev DB, check the table below first. If the spec is
listed as "self-resetting" but the failure persists, the bug is likely in the
production code path the assertion exercises — open a sibling story rather than
weakening the assertion.

## Fixture taxonomy

Specs fall into one of three categories:

| Category | Trait | Reset strategy |
|----------|-------|----------------|
| **Self-contained** | Read-only navigation; assert on baseline demo data | None |
| **Lineup-scoped** | Create/mutate lineups, polls, tiebreakers | `POST /admin/test/reset-lineups` with per-worker `titlePrefix = smoke-w${workerIndex}-${FILE_PREFIX}-` |
| **Demo-scoped** | Need a fresh full demo seed | `POST /admin/test/reset-to-seed` once in `test.beforeAll` |

All resets MUST use the per-worker prefix where applicable so sibling workers
running the parallel `mobile` project don't archive each other's lineups.
`fullyParallel: false` is set per-project; cross-project (desktop ↔ mobile) is
still parallel.

## Per-spec table

| Spec | Category | Reset/seed endpoint | Per-worker prefix? | Notes |
|------|----------|---------------------|--------------------|-------|
| `activity-timeline.smoke.spec.ts` | Self-contained | Creates event + signs up admin in `beforeAll` | n/a | ROK-1070: explicit signup via `POST /events/{id}/signups` (creator is NOT auto-signed-up by `createSingleFlow`). |
| `admin-discord.smoke.spec.ts` | Self-contained | None | n/a | Read-only admin page rendering. |
| `admin-general.smoke.spec.ts` | Self-contained | None | n/a | Read-only admin page rendering. |
| `admin-integrations.smoke.spec.ts` | Self-contained | None | n/a | Read-only admin page rendering. |
| `admin-operations.smoke.spec.ts` | Self-contained | None | n/a | Read-only admin page rendering. |
| `admin-plugins.smoke.spec.ts` | Self-contained | None | n/a | Read-only admin page rendering. |
| `admin-slow-queries-log.smoke.spec.ts` | Demo-scoped | `POST /admin/test/seed-slow-queries-log` in `beforeEach` | n/a | ROK-1070: replaces real cron trigger to avoid `/data/logs` perms dependency on Mac dev. |
| `auth.smoke.spec.ts` | Self-contained | None | n/a | Login/logout flows. |
| `calendar.smoke.spec.ts` | Self-contained | None | n/a | Calendar rendering. |
| `character-detail.smoke.spec.ts` | Self-contained | None | n/a | Read-only baseline demo characters. |
| `characters.smoke.spec.ts` | Self-contained | None | n/a | Read-only character list. |
| `community-insights.smoke.spec.ts` | Self-contained | None | n/a | Read-only insights page. |
| `community-lineup.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` | yes | ROK-1070: switched bare POST `/lineups` to `createLineupOrRetry` to avoid `/lineups/banner` fallback. |
| `create-event.smoke.spec.ts` | Demo-scoped | `reset-to-seed` once | n/a | ROK-1070: keeps event-creation-redirect test deterministic across runs. |
| `dynamic-categories.smoke.spec.ts` | Self-contained | `POST /admin/test/seed-discovery-categories` per-test via `seedSuggestion()` | n/a | Established pattern, predates ROK-1070. |
| `edit-event-content.smoke.spec.ts` | Self-contained | None | n/a | Edits an existing demo event. |
| `edit-event.smoke.spec.ts` | Self-contained | None | n/a | Edits an existing demo event. |
| `event-game-time-modal.smoke.spec.ts` | Self-contained | None | n/a | Modal open/close. |
| `event-metrics.smoke.spec.ts` | Self-contained | None | n/a | Read-only metrics rendering. |
| `events.smoke.spec.ts` | Demo-scoped | `reset-to-seed` once | n/a | ROK-1070: ensures clean events list for mobile-search assertion. |
| `game-detail.smoke.spec.ts` | Self-contained | None | n/a | Read-only game detail. |
| `games.smoke.spec.ts` | Self-contained | None | n/a | Read-only game list. |
| `lineup-abort.smoke.spec.ts` | Lineup-scoped | `reset-lineups` | yes | Existing pattern. |
| `lineup-auto-advance.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `cancel-lineup-phase-jobs` | yes | Existing pattern. |
| `lineup-creation.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` | yes | ROK-1070: switched bare POST `/lineups` to `createLineupOrRetry`. |
| `lineup-decided.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` | yes | ROK-1070: switched fixture builder to `createLineupOrRetry`; mobile empty-state timeout bumped to 20s. |
| `lineup-phase-breadcrumb.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` + `cancel-lineup-phase-jobs` | yes | ROK-1070: replaces banner-fallback in `ensureActiveLineup`. |
| `lineup-tiebreaker.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + tiebreaker fixture polling | yes | ROK-1070: added `await-processing` + API-level state poll before page goto for bracket-view race. |
| `lineup-votes-per-player.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` | yes | Already fixed pre-ROK-1070. |
| `notifications.smoke.spec.ts` | Demo-scoped | `reset-to-seed` once | n/a | ROK-1070: clears stale notifications. |
| `onboarding.smoke.spec.ts` | Demo-scoped | `POST /admin/test/reset-onboarding` once | n/a | ROK-1070: clears `onboardingCompletedAt` + `gameTimeConfirmedAt` so the wizard breadcrumb renders the fresh-onboarding shape. |
| `paste-nominate.smoke.spec.ts` | Lineup-scoped | `reset-lineups` + `createLineupOrRetry` | yes | ROK-1070: AC6 describe block migrated. |
| `plan-event.smoke.spec.ts` | Demo-scoped | `reset-to-seed` once | n/a | ROK-1070: clears stale events from "scheduled events" list. |
| `scheduling-poll.smoke.spec.ts` | Lineup-scoped | `reset-lineups` with `phases=['building','voting','decided','scheduling']` | yes | ROK-1070: file's fixtures live on decided/scheduling rows; default phases=['building','voting'] left them stale. |
| `scheduling-poll-threshold.smoke.spec.ts` | Self-contained | `PUT /users/me/game-time` once | n/a | ROK-1070: unfreezes the SchedulingWizard guard so the vote-progress-bar assertion can render. |

## Test-only API endpoints

All endpoints under `/admin/test/*` are **DEMO_MODE-gated** (env var + DB
flag) and require an authenticated admin (JWT + `AdminGuard`). They are
defined in `api/src/admin/demo-test-*.controller.ts`.

| Endpoint | Purpose | Body |
|----------|---------|------|
| `POST /admin/test/reset-to-seed` | Wipe events / signups / lineups / characters / voice + reseed demo data | `{}` |
| `POST /admin/test/reset-lineups` | Archive lineups by `titlePrefix` (and optional `phases`) | `{ titlePrefix, phases? }` |
| `POST /admin/test/reset-events` | Hard-delete events by `titlePrefix` | `{ titlePrefix }` |
| `POST /admin/test/reset-onboarding` | Clear admin's `onboardingCompletedAt` + `gameTimeConfirmedAt` | `{}` |
| `POST /admin/test/seed-slow-queries-log` | Write a deterministic line into `slow-queries.log` | `{}` |
| `POST /admin/test/await-processing` | Drain all BullMQ queues | `{}` |
| `POST /admin/test/cancel-lineup-phase-jobs` | Cancel pending phase-transition jobs for a lineup | `{ lineupId }` |
| `POST /admin/test/seed-discovery-categories` | Seed deterministic discovery category suggestions | various |

See `api/src/admin/demo-test-*.controller.ts` and `demo-test.schemas.ts`
for the full list and exact body shapes.

## Adding a new smoke spec

1. Decide the fixture category (self-contained / lineup-scoped / demo-scoped).
2. If lineup-scoped, set up `workerPrefix = smoke-w${workerIndex}-${FILE_PREFIX}-`
   in a top-level `test.beforeAll(({}, testInfo) => { ... })`.
3. Use `createLineupOrRetry` (from `api-helpers.ts`) for any `POST /lineups`
   call so sibling-worker 409 collisions trigger a prefix-scoped reset rather
   than reusing the banner row.
4. Add the spec to the table above with its category, reset endpoint, and any
   notes future maintainers need.
5. If the spec exposes a new state requirement that no existing reset endpoint
   covers, prefer extending an existing endpoint (additive `phases` arg etc.)
   over adding a brand-new one.
