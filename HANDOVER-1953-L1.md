# ROK-1953 L1 handover: contract, Steam client, Core setup copy

## Handover

**Status:** L1 is done and green. Commits: `fd2788e7c` (contract + setup copy) and `153e686ec` (Steam client). Nothing is red or uncommitted.

Evidence:
- contract vitest: 3 files, 33 tests pass (`steam-app-stats.schema.spec.ts`, `plugin-setup.schema.spec.ts`, `plugin-hub-manifests.spec.ts`). The contract builds.
- api jest: `steam-achievements-http.util.spec.ts` 15/15 pass. `npx tsc --noEmit -p api/tsconfig.json` (repo root) exits 0. eslint shows 0 errors and 1 warning (`max-lines-per-function` on the `getSchemaForGame` describe block in the spec).
- Mutation check: breaking the not-public match makes U2 fail with `"kind": "private"` → `"error"`. Making a missing `hidden` count as visible makes OQ5 fail with `"hidden": true` → `false`.

## Exports for L2–L4

`@raid-ledger/contract` (`packages/contract/src/steam-app-stats.schema.ts`):
- `STEAM_STATS_STATUSES`, `SteamStatsStatusSchema`, `SteamStatsStatus` (`ok|private|not_owned|pending|unlinked|error`)
- `SteamAchievementMaskedSchema` (`{masked:true, globalPct}` strict), `SteamAchievementFullSchema`, `SteamAchievementViewSchema`, `SteamAchievementView`
- `SteamHubMemberStatsSchema`, `SteamHubMemberStats` (`userId` positive int, `displayName`, `avatarUrl|null`, `status`, `unlockedCount|null`, `playtimeMinutes|null`, `fetchedAt` ISO|null)
- `SteamHubUnlockSchema`, `SteamHubUnlock` (`userId`, `unlockedAt` ISO, `achievement`)
- `STEAM_HUB_RECENT_UNLOCKS_MAX = 8`
- `SteamHubStatsResponseSchema`, `SteamHubStatsResponse` (union on `available`; `{available:false}` strict)
- `globalPct` is 0–100, nullable. Every object is `.strict()`.

`api/src/steam/steam-achievements-http.util.ts` (plain functions, no Nest):
- `getPlayerAchievements(apiKey, steamId, appId): Promise<SteamPlayerAchievementsResult>` returns `{kind:'ok', unlocked: SteamUnlockedAchievement[]}`, `{kind:'private'}`, `{kind:'not_owned'}`, `{kind:'rate_limited'}` or `{kind:'error', status}`
- `getSchemaForGame(apiKey, appId): Promise<SteamSchemaResult>` returns `{kind:'ok', achievements: SteamSchemaAchievement[], missingHidden: number}` or `SteamFetchFailure`
- `getGlobalAchievementPercentages(appId): Promise<SteamGlobalPercentagesResult>` returns `{kind:'ok', percentages: Map<apiName, number>}` or `SteamFetchFailure`
- `SteamFetchFailure = {kind:'rate_limited'} | {kind:'error'; status}`. `status: 0` means a network error or the timeout.
- `STEAM_ACHIEVEMENTS_TIMEOUT_MS = 10_000`
- Types re-exported from `steam-achievements-parse.helpers.ts`:
  - `SteamUnlockedAchievement {apiName, unlockedAt: Date | null}`
  - `SteamSchemaAchievement {apiName, name, description|null, icon|null, hidden}`
- Fixtures for L2 specs: `api/src/steam/testing/steam-achievements.fixtures.ts`.

## Decisions a successor should not undo (with reasoning)

1. **The schema and percentage fetchers return a result union, not a bare array or Map.** The spec table shows the bare return. The refresh service still has to tell a failure (`schema_status='error'`, keep old rows) apart from "no achievements" (`[]`), and it has to see a 429 to circuit-break (D5). With a bare return, those three cases would look the same.
2. **A schema entry with no `hidden` field is treated as hidden (masked until earned) and counted in `missingHidden`.** The safe default for privacy is to mask. L2 should `logger.warn` when `missingHidden > 0`. Per OQ5, that app should not go on the enable list.
3. **`unlockedAt: null` when Steam reports `unlocktime: 0` on an achieved entry.** This happens for very old unlocks. The contract's `SteamHubUnlock.unlockedAt` cannot be null. L2/L3 should keep any existing stored `unlocked_at`, or leave the row out of `recentUnlocks`.
4. **Classification reads Steam's error text first.** `private` requires the "not public" text, and `not_owned` requires "no stats". A bare 403, an HTML 502 or a non-JSON body is always `error` and never `private`. Only HTTP 429 is decided by status alone.
5. **The API key goes only into the request URL.** No result or error carries the URL. The global % call sends no key.
6. **D7 copy is verbatim from the spec.** `steam-api-key` and `player-steam-link` are both `required:false`, with no `appliesTo`. `check: 'core.steam_api_key'` is not wired yet and reports unknown. Setup copy only (no new key or setting, per the spec). The admin path "Admin → Integrations → Steam" matches `integrations/steam` (`web/src/app-routes.tsx:75`), whose page heading is "Steam". The no-secret guard regex stays green, and the copy mentions no key prefix. I changed the old `'Core needs nothing'` test in `plugin-setup.schema.spec.ts` to assert the two new ids and that neither is required. This is an intentional behaviour change; the test was not weakened.

## UNVERIFIED (L0 must pin with captured, anonymised bodies)

- Private profile = 403 `{"playerstats":{"error":"Profile is not public","success":false}}`
- Not owned = 400 `{"playerstats":{"error":"Requested app has no stats","success":false}}`
- A game with stats but no achievements = 200 with `success:true` and no `achievements` key
- `hidden` is 0/1 on GetSchemaForGame/v2. A hidden achievement's `description` is blank or absent.
- GetGlobalAchievementPercentagesForApp/v2 sends `percent` as a string. Numbers are also accepted, and anything that cannot be parsed is dropped.
- No game in schema = `{"game":{}}`

## Not done (out of L1 scope)

Tables, migration, jobs, routes, the mask helper, `HUB_PLUGIN_MANIFESTS.core` widgets and behaviours (L2/L4), and all web work.
