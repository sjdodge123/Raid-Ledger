# Handover — ROK-2352 L5 (WoW adapter, api)

## Done
- 315c67fc5 `api/src/plugins/wow-common/lfg/`: `wow-lfg-catalogue.ts` (slug→variant, key mint/parse, descriptors),
  `wow-lfg-detail.helpers.ts` (parse/validate, own-character check, upsert, member details, carryover, last-detail read),
  `wow-lfg-lock-in.helpers.ts` (slotConfig mmo per `wowRosterShapeForSize`, contentInstances, title),
  `wow-lfg-grouping.adapter.ts` (`behaviourId = 'wow-instance-lfg'`), `wow-lfg.registration.ts` (6 slugs,
  ownerPluginId `blizzard`, called from `WowCommonModule.registerAdapters`). Unit specs for catalogue + detail parse.

## Decisions (do not undo)
- Catalogue variants (`classic_era`, `wow_forever`) read the local catalogue (has maxPlayers); retail/TBC/Wrath/Anniversary
  read `BlizzardService.fetchAllInstances` (maxPlayers null → category default size). Journal failure → [] + warn
  (describeGroup → null → core 400).
- Region default `us` (same as `GET /blizzard/instances`; the web content browser passes none).
- `world-of-warcraft-classic` = Classic ERA (seed name "World of Warcraft Classic Era", web `slugToContentVariant`).
- Lock-in: `groupKey || chosenGroupKey`; neither → `{ carryover }` only (generic roster). No `bench` in slotConfig (L6 decides).

## NOT DONE (next lane)
- Integration spec (real DB): save/read/lock-in patch/carryover, foreign + wrong-game character → 400. Suggested
  `api/src/plugins/wow-common/lfg/wow-lfg-grouping.integration.spec.ts`.
- `wow-lfg.controller.ts` `/plugins/wow/lfg` (`GET :gameId/last-detail`, `PUT hands/:intentId/detail`) behind
  `@RequirePlugin(WOW_COMMON_MANIFEST.id)`; helper `readWowLastDetail` exists.
- Forever `ruleset` check on the character (§3.3) — not applied; saveHandDetail ctx carries no hub/ruleset.

## RED (mine)
- `wow-common.module.ts` max-lines 306 > 300 (was exactly 300 on base; wiring added 6: 2 imports, 2 providers,
  1 ctor param, 1 call) + `registerAdapters` 31 lines (warn). Fix: extract `registerAdapters`/`registerHubKind`
  (+ the lfg call) out of the module, OR `import * as wowLfg` + `...wowLfg.PROVIDERS` and make `WowLfgRegistration`
  self-register in `onModuleInit` (store suspends owner-tagged adapters; confirm uninstall does not drop them) — still
  needs ~2 lines freed elsewhere. Do NOT route the registerAdapter call through a variable point: the guard scanner needs
  the literal `EXTENSION_POINTS.LFG_GROUPING` first arg and a `this.<field>` typed as the adapter class in the same file.
- lane-check `jest api/src/lfg` FAIL and eslint `hub-registration-scan.ts` FAIL are not from this lane (L4 in-flight /
  pre-existing in scanner file — scanner file shows 0 errors when linted alone).
