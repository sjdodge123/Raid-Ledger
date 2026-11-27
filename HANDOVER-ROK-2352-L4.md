# Handover — ROK-2352 L4 (core reads) — PARTIAL

## Done (commit e438dc4d2 on rok-2352-lfg-wow-groups)
- **Scope concept** `api/src/lfg/lfg-group-scope.helpers.ts`: `LfgGroupScope = string | null` (null = every hand of
  the game = the fold, and `DELETE ?group=*`). `groupScopeFilter`, `resolveReadGroupScope`, `resolveWithdrawScope`,
  `resolveDetailGroup` (unknown key + active adapter → 400, same as writes), `distinctUsers()`, `membersForScope`
  (fold = one row per user, soonest-expiring hand wins), `findOwnLiveHand`, `listOwnOtherGroups`, and
  `clearIntent(db,u,g,scope=null)` (moved here; re-exported from `lfg-write.helpers.ts`).
- `groupColumns`: `activeCount` / `nowCount` are now **count(DISTINCT user_id)** (fold + Q7 game rows). Non-WoW
  unchanged (one hand per user per game). `liveIntent(now, scope=null)`; `getGroupSummary(…, scope=null)`,
  `listGroupMembers(…, scope=null)`, `refreshGroupExpiry(…, tz, scope=null)` — defaults = whole game.
- `POST /lfg` path counts + refreshes the group the hand landed in (`post.grouping ? groupKey : null`).
- `toIntentDto` projects `groupKey`.
- `GET /lfg/:gameId?group=` → detail with `groupKey`, `groupLabel`, `ownOtherGroups` (only when an adapter is active).
- `GET /lfg/:gameId/groups?include=catalogue` → `LfgReadsService.listGameGroups` → `lfg-group-list.helpers.ts::readGroupList`
  (`''` "any" first, then catalogue groups that are live, busiest first; `include=catalogue` adds empty ones; keys the
  adapter does not list are dropped). Fold → just `''` with folded counts.
- `GET /lfg` → `attachGroupCounts`: `groupCount` (folded game: 1), grouped game's `state` from the busiest group.
- `DELETE /lfg/:gameId?group=` (`*` = all). **Decision:** in a folded game a withdraw clears EVERY hand (the viewer
  sees one group; clearing only `''` would leave keyed hands they cannot remove). Spec §3.7 says "?group=x treated as
  ''" — flag to Lead.
- `announcePost` moved out of `LfgService` to `lfg-post-announce.helpers.ts` (line cap); `lfg-query-parse.helpers.ts::parseQuery`.

## NOT DONE (next lane)
1. `?group` on overlap / history / suggestions / invites (`LfgReadsService.getOverlap/getHistory/getSuggestions`,
   `LfgInviteService.invite`), and `countGroupInvitesSince(db, gameId, since, groupKey)` + invite rows writing
   `groupKey` (`lfg-invite.helpers.ts:41`). Pattern: controller `parseQuery(LfgGroupQuerySchema, query)` →
   `resolveReadGroupScope(resolveLfgGrouping(registry, game.slug), group)` → pass scope into the helper's WHERE via
   `groupScopeFilter(scope)` / `liveIntent(now, scope)`.
2. **Integration specs (none written by L3 or L4)** — suggested `api/src/lfg/lfg-groups.integration.spec.ts`:
   register a test adapter in the spec: `registry.registerAdapter(EXTENSION_POINTS.LFG_GROUPING, game.slug, adapter,
   { ownerPluginId: 'blizzard' })` after `ensureInstalled('blizzard')` + `activate('blizzard')`; fold =
   `deactivate('blizzard')`. Cases: 6th live hand → **409** (spec AC3 says 400 — L3 chose 409, keep and flag); two
   groups for one user coexist (new conflict target); fold writes `''` for `groupKey:'dungeon:1'`; unknown key 400;
   AC4 `/groups` + `?group` detail scoping (members only of that group, `ownOtherGroups`); AC8 fold → `/groups` returns
   only `''` with distinct-user counts, `GET /lfg` `groupCount` 1; re-activate restores split.
3. Unit specs for `lfg-group-scope.helpers.ts` (dedupe) and `lfg-group-list.helpers.ts` ordering — none yet.
4. Existing unit specs that pin `toIntentDto` output / `getGroupSummary` call args may need `groupKey: ''` / the extra
   `scope` arg — see lane-check table in the L4 reply.

## Follow-up commit
- `LfgService.withdraw(userId, gameId, group?)`: `group === undefined` (Discord `/lfg-leave`, internal callers) = every
  hand, no game read; the HTTP route always passes one (schema default `''`). Keeps the unit mocks and the Discord path.
- `lfg.service.converted-event.spec.ts` now mocks `findOwnLiveHand` / `listOwnOtherGroups` (the own-hand read moved).
- lane-check: RESULT PASS (all rows green, plugin-host included — L5 has registered the adapter).
