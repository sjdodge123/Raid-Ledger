# ROK-1953 L2 handover: tables, nightly refresh, migration

## Handover

**Status:** L2 done. Commits `7cfe762c4` (schema + storage), `d35a47ea4` (refresh + targets), `aa71d3782` (job, module, ownership), `279830bf3` (integration spec), then the migration as the last commit (`0257_steam_app_stats.sql` — drizzle-kit's number; the spec says this story is ≥0258, so the Lead renumbers with `./scripts/renumber-branch-migrations.sh` at merge).

Evidence: refresh unit spec 10/10, listener spec 3/3, ownership guard + cron guard green (34 tests across `plugins/core`, `hub-ownership.guard.spec.ts`, `cron-handlers.guard.spec.ts`); contract `plugin-hub-manifests.spec.ts` 13/13; schema guards (constraint-name-length, fk-index-coverage, migration-snapshots) 11/11; `npx tsc --noEmit -p api/tsconfig.json` exit 0; eslint 0 errors (spec `describe` length warnings only). `fix-migration-order.sh --check` OK.
Mutations: dropping the 429 rethrow → R5 `Received promise resolved instead of rejected`; renaming the cron → guard lists `core/scheduled-job/SteamAppStatsProcessor_renamed is registered but not declared` + `…_scheduledRefresh is declared but nothing registers it`.

**NOT run (fleet):** `api/src/plugins/core/steam-stats/steam-stats.targets.integration.spec.ts` (T1–T4, S1–S3). The Nest DI preview probe was not run (no laptop app boot) — `CoreSteamStatsModule` imports `GuildsCoreModule`, `SettingsModule`, `CronJobModule`, the queue; `QueueModule` + `DrizzleModule` are global.

## For L3 (read route)

All under `api/src/plugins/core/steam-stats/`:
- `core-steam-stats.module.ts` — add the controller + read service here. It exports `SteamStatsStorageRepository`.
- `steam-stats.constants.ts` — `STEAM_STATS_APP_IDS` (Set, 1086940), `STEAM_STATS_HUB_KINDS`, `STEAM_APP_STATS_QUEUE`, `SteamRateLimitedError`, `SteamAppStatsJobData`.
- Tables (`api/src/drizzle/schema/steam-app-stats.ts`, in the barrel): `steamAppStatsApps` (`schemaStatus` ok|no_stats|error, `achievementCount`), `steamAppAchievements` (`globalPct` is a numeric **string** like `'12.500'` — parse it), `steamUserAppStats` (`status`, `unlockedCount` null unless ok, `fetchedAt`), `steamUserAchievements`.
- A member with no `steam_user_app_stats` row = `pending`; `users.steam_id IS NULL` = `unlinked` (D6; rows kept).

## Decisions (do not undo)

1. **`steam_user_achievements.unlocked_at` is NULLABLE** (spec said not null). Steam reports `unlocktime: 0` on very old unlocks (L1 decision 3); the row must exist so masking knows the viewer earned it. **L3: filter `unlocked_at IS NOT NULL` for `recentUnlocks`.** Index is `(app_id, unlocked_at DESC NULLS LAST)`. A later fetch with a real time fills a NULL (`COALESCE(stored, excluded)`); a stored time is never overwritten.
2. Every write is one `INSERT … ON CONFLICT (pk) DO UPDATE` with the input de-duplicated by `api_name` first (a duplicate in one statement would raise "cannot affect row a second time"). No catch-and-retry inside a transaction.
3. Non-`ok` statuses write `unlocked_count = NULL` (I5 expects null for `private`); unlock rows untouched.
4. Schema with 0 achievements → `no_stats`, and **no per-user calls** for that app (nothing to fetch; Steam would answer "no stats" and misclassify users as `not_owned`). A failed global % fetch keeps the stored % (`pct` null). A 429 on either the schema or the % call also circuit-breaks.
5. On-link refresh (D6) does NOT fetch the schema; it only refreshes apps whose stored `schema_status = 'ok'` (first-ever schema comes from the nightly run).
6. Targets exclude `users.deactivated_at IS NOT NULL`. Hidden hubs (`hidden_at`) are NOT excluded (spec only names archived). Live hub = `archived_at IS NULL AND status <> 'archived'`.
7. Cron is `'0 30 4 * * *'` (6-field = 04:30), literal name `SteamAppStatsProcessor_scheduledRefresh`, wrapped in `executeWithTracking` (cron guard); BullMQ `attempts: 3`, exponential backoff base 10 min. Link jobs use `jobId: steam-stats-link-<userId>` with `removeOnComplete/removeOnFail` so a re-link enqueues again.

## Not done

T1 server-hub variant (needs a Pelican fixture — fold into L3's read spec); the read route, mask, demo seed (L3); web (L4).
