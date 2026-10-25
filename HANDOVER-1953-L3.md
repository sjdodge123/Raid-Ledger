# ROK-1953 L3 handover: read route, masking, demo seed

## Handover

**Status:** L3 done; nothing uncommitted. Commits `96df3537f` (mask + helpers), `3732c1082` (route), `d793b26cd` (seed), `ddad3f9bf` (integration spec, NOT run).

Evidence (laptop): unit specs `steam-stats.mask.spec.ts` + `steam-stats-read.helpers.spec.ts` green; with `hub-ownership.guard.spec.ts`, `cron-handlers.guard.spec.ts`, the L2 core specs: 6 suites / 48 tests pass. `npx tsc --noEmit -p api/tsconfig.json` (repo root) exit 0. eslint on touched files: 0 errors, 0 new warnings. Mutation: flipping the mask predicate (`!viewerUnlocked.has` → `viewerUnlocked.has`) turns 4 of 5 mask tests red.

**Run on the fleet (Redis sidecar):** `api/src/plugins/core/steam-stats/steam-stats.read.integration.spec.ts` (I1–I9 + seed) and L2's `steam-stats.targets.integration.spec.ts`. Nest DI probe not run — `CoreSteamStatsModule` now also declares `SteamStatsController`, `SteamStatsReadRepository`, `SteamStatsReadService` (needs `GuildAccessService`, `HubKindRegistry` from `GuildsCoreModule`, already imported). `DemoTestSteamAppStatsController` is in `AdminModule` (db only).

## Route (for L4)

`GET /hubs/:guildId/steam-stats` — JWT; `Cache-Control: private, no-store`.
- missing / hidden-from-viewer / non-member (non-staff) → **404** `{ message: 'Guild not found' }` (same body); no JWT → 401; non-int id → 400.
- WoW hub, no game, no app id, app id not in `STEAM_STATS_APP_IDS` → **200 `{ available: false }`**.
- else 200 `SteamHubStatsResponse` (contract, `available: true`):
  - `totalAchievements` = app row `achievement_count` when `schema_status='ok'`, else 0 (no app row yet → 0).
  - `viewer.status` — computed for staff non-members too (from their own user row).
  - `members[]` — live hub members (kind adapter `memberUserIds`), not deactivated; order count desc, nulls last, name. `displayName` = display name ?? username; `avatarUrl` = `publicAvatarUrl(custom_avatar_url)`.
  - `recentUnlocks` (≤8) + `rarestUnlock` (lowest global %, earliest earner) from linked live members only; `unlocked_at IS NULL` rows excluded from feeds but still unmask for their owner.
  - `refreshedAt` = app `schema_fetched_at`.

## Decisions (do not undo)

1. **Unlinked member: `unlockedCount`, `playtimeMinutes`, `fetchedAt` all null** (rows kept). Showing Steam-derived playtime for someone who unlinked contradicts "hidden from feeds". `private` keeps playtime (comes from the library sync).
2. Masked objects are built from scratch (`{ masked, globalPct }`), never spread from the row; staff get no unmask (D8).
3. The gate is local (`findHiddenAt` → `isHiddenFrom` → `access.canView`), mirroring `assertCanViewHubMedia`, so `plugins/core` does not import `hub-media`.
4. **Seed is community-only and reuses `community-member-1..4` as A..D** (they are the `community-hubs` crew users; the seed re-joins them so it also works standalone). Server hubs need a Pelican fixture — out of scope. Spec path `api/src/admin/demo-test-steam-app-stats.controller.ts`; same guards as the other seeds (`AuthGuard('jwt')`, `AdminGuard`, `DemoModeGuard`, `@SkipThrottle`).
5. Nothing new is a hub extension point (route + seed only), so the ownership guard needed no new declaration; it stays green.
6. I7's WoW arm is a unit test on `enabledAppId` (a WoW row needs realm columns).

## Seed calls (fleet test plan, as `admin@local`, AFTER the fleet gate)

1. `POST /admin/test/community-hubs/seed` `{}` → `hubIds.crew` = `<H>` (BG3 crew hub when the BG3 game exists).
2. `POST /admin/test/steam-app-stats/seed` `{ "guildId": <H> }` → `{ guildId, gameId, appId: 1086940, users: { a, b, c, d: { userId, username } }, hiddenUnlockedBy: 'a' }`. Idempotent; reset hint "re-run the steam-app-stats seed for `<H>`". Sets the game's app id (`manual`) if it was NULL; 400 for a non-BG3 or non-community hub.
3. Data: 6 achievements — 4 visible, 2 hidden (`Demo Secret Ending` 2.7 %, `Demo Secret Romance` 18.6 %). A (`community-member-1`) `ok` 5/6 incl. both hidden, 7260 min; B (`community-member-2`) `ok` 3/6, 2400 min; C (`community-member-3`) `private`; D (`community-member-4`) unlinked with a kept row + the newest unlock (must NOT show). As B: rarest + two recent rows read "Hidden achievement" with %. As A: names shown.

## Not done

Web (L4), Playwright (L5), Valheim-hub step of the plan (L5 picks the endpoint).
