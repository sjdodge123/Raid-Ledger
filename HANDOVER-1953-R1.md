# ROK-1953 review fix round 1

## Handover

**Status:** done; tree clean apart from the untracked `REVIEW-1953.md`. Commits: `e82796d27` (MAJOR 1 + processor guard), `a8fee6af5` (MAJOR 2 + seed transaction + steam_id guard + the seed spec's 403).

Laptop evidence: `npx tsc --noEmit -p api/tsconfig.json` and `npx tsc --noEmit -p scripts/smoke/tsconfig.typecheck.json` from the repo root both exit 0. Unit: `src/plugins/core`, `src/cron-jobs`, `hub-ownership.guard`, `steam-id-writer.guard`, `bullmq-processors.guard` give 138/138. eslint on the touched api files: 0 errors (2 old warnings for describe length in specs).
Red-first: `appTotals` failed on `totalAchievements` with expected 6, received 0. The refresh test failed with "saveUserOk ... Number of calls: 0". Both are green after the fix.

## Run on the fleet (Redis sidecar), all NOT run here
- `api/src/plugins/core/steam-stats/steam-stats.read.integration.spec.ts`: new I10 (a schema error keeps count 3 and refreshedAt), plus the rewritten seed block (200 + idempotent + own disabled game + shared BG3 row untouched; 409 when a real game holds the app id; 403 without the DB setting).
- `api/src/plugins/core/steam-stats/steam-stats.targets.integration.spec.ts`: S3 now also pins `schemaFetchedAt: t0` and `hasUsableSchema`.
- Playwright: `scripts/smoke/hub-steam-stats.smoke.spec.ts` (it now seeds with `{}` only).

## Findings
- MAJOR 1, fixed. `markSchemaError(appId)` writes only `schema_status='error'`. The count, the rows and `schema_fetched_at` (the last success) stay as they were. The nightly run always fetches the schema again. `hasUsableSchema` (count > 0) gates `refreshUser`. The read route takes `appTotals` = the stored count, and `refreshedAt` = the last success.
- MAJOR 2, fixed. The seed body is now `{}`. It finds or creates its own game "Steam Stats Demo (BG3)" (`steam-stats-demo-bg3`) with **`enabled=false`**, so `/games/configured` (the picker in every hub spec) never lists it, and it holds app 1086940. It also creates its own hub "Steam Stats Crew". The community-hubs reset only covers the game it seeds, so it never touches this hub. No shared game row is changed. `games.steam_app_id` is UNIQUE, so the seed returns 409 if a real game already holds 1086940. It does not move the id over, and it checks first, so nothing violates the constraint inside the transaction. The games INSERT runs under `withGameNameLock` with `findGameByNormalizedName`. No other spec's picker needed changing.
- Fleet failures: (1) the 403 came from the test, not the guard. `DemoModeGuard` needs both `process.env.DEMO_MODE` and the DB setting, and the spec set only the env. It now calls `SettingsService.setDemoMode(true)`, as the valheim seed specs do. (2) `users.steam_id` is now written through `setSteamIdReturningPrevious` / `clearSteamIdReturningPrevious`, the sanctioned writers; nothing was added to an allowlist. (3) the processor's `process()` now has a try/catch that logs `err.name` and rethrows, so BullMQ retries.
- MINOR seed transaction: fixed. The whole seed runs in one `withGameNameLock` transaction, which also serialises concurrent seeds.
- NIT job-name literal: comment added. Other MINORs/NITs (fetched_at starvation, cap rotation, Retry-After, cron row): skipped, as none is a one-liner. Migration renumber: the Lead does it at merge.

## Not done / watch
- Seed users are still `community-member-1..4` / `community-leader`, shared with the community-hubs fixture. Their `steam_id` is set by this seed. No hub spec asserts on it.
- Plan rows from L5: seed with `POST /admin/test/steam-app-stats/seed {}` → `guildId` = `<H>`. Drop the community-hubs step.
- Spec §4.5 still describes `{ guildId }`. Reconcile it.
