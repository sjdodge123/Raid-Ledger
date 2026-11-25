# Handover — ROK-2352 L3 (core seam + write path)

## Done (commits on rok-2352-lfg-wow-groups)
- 5a9fa6956 `EXTENSION_POINTS.LFG_GROUPING = 'lfg-grouping'` (+ in `HUB_EXTENSION_POINTS`, so `ownerPluginId` is
  required); interface `api/src/plugins/plugin-host/lfg-grouping.adapter.ts`; scanner `HUB_POINT_KINDS.LFG_GROUPING`;
  scanner reads the declared id from the adapter class's `readonly behaviourId = '<id>'` (key is a loop slug);
  guard spec `HUB_POINT_NAMES` + 2 probes.
- e780d318c `api/src/lfg/lfg-grouping.helpers.ts`: `resolveLfgGrouping`, `resolveWriteGroupKey` (fold → '', unknown → 400),
  `assertHandCap` (`LFG_MAX_HANDS_PER_GAME = 5`, counts live hands in OTHER groups, 409). `insertIntent` writes
  `groupKey`, conflict target `(user_id, game_id, group_key) WHERE status='active'`; `findActiveIntent(db,u,g,groupKey='')`.
- e00dd2954 `POST /lfg` passes `groupKey`/`handDetail`; `lfg-group-post.helpers.ts` (`resolvePostGroup`,
  `saveHandDetailIfAny`, `LfgPostRequest`); cap + insert + `saveHandDetail` run on the per-game-locked tx.
  `LfgService` now injects `PluginRegistryService` (global module). `toConversionTarget` moved to provenance helpers (size cap).

## Decisions (do not undo)
- KEY_TO_ID not used: six slug registrations resolve through `behaviourId` instead. L5's adapter class MUST declare
  `readonly behaviourId = 'wow-instance-lfg'` and register as
  `registerAdapter(EXTENSION_POINTS.LFG_GROUPING, slug, this.<field>, { ownerPluginId: WOW_COMMON_MANIFEST.id })`
  with `<field>` typed as the class in the same file's constructor.
- Cap → `ConflictException` (409). Unknown key with adapter active → 400; plugin off → silently ''.
- `handDetail` with no adapter is ignored (fold).

## RED (expected until L5)
- `hub-ownership.guard.spec.ts`: the exact-drift tests carry one extra line
  `blizzard/lfg-grouping/wow-instance-lfg is declared but nothing registers it` (L1 declared it; L5 registers it).
  Before this lane they were red with "...the guard has no scanner for lfg-grouping".

## NOT DONE (next lane)
- Integration spec for the write path (cap at 5 → 409 on the 6th, two groups coexist for one user, plugin-off fold
  writes '', unknown key 400). Suggested `api/src/lfg/lfg-groups-write.integration.spec.ts`, fleet-only.
- `refreshGroupExpiry` / `getGroupSummary` / `clearIntent` are still game-wide (reads/withdraw = L4).
- `toIntentDto` does not project `groupKey` yet (L4 read DTOs).
