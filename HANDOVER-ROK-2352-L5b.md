# Handover — ROK-2352 L5b (finish the WoW adapter)

## Done
- 4e097fe5e — `wow-common.module.ts` back under 300: LFG classes via `import * as wowLfg` + `...wowLfg.PROVIDERS/CONTROLLERS`;
  `WowLfgRegistration` self-registers in `onModuleInit` (owner-tagged → registry suspends/restores on deactivate/activate,
  uninstall does not drop adapters; boot-order restore via `refreshActiveCache → restoreActiveOwners`). `@nestjs/common`
  lifecycle interfaces moved to an `import type` line. Identity spec ctor arg removed.
  New `lfg/wow-lfg.controller.ts` `plugins/wow/lfg` (PluginActiveGuard + `@RequirePlugin('blizzard')` + JWT):
  `GET :gameId/last-detail` → `{ detail }`, `PUT hands/:intentId/detail` (204; own active hand else 404; non-WoW game 400)
  via `lfg/wow-lfg-intent.helpers.ts::loadOwnWowIntent` + `adapter.saveHandDetail` in one tx.
- d51886b0a — `lfg/wow-lfg-character-variant.ts::wowCharacterFitsSlug` (Forever = gameVariant OR ruleset via
  `isForeverCharacter`; bare row on the Forever game counts as Forever) + unit spec; applied in `assertOwnCharacter`.
- 1774e28d9 — `lfg/wow-lfg-grouping.integration.spec.ts` (NOT yet run — fleet only).

## Next
- Run the integration spec on the fleet runner (needs Redis sidecar). Risk: blizzard plugin active in TestApp for the
  HTTP cases (PluginActiveGuard) — if 403/404 on the routes, check ensureInstalled in the TestApp.
- lane-check `jest api/src/lfg` FAIL = `LfgService lifecycle events › withdraw` (L4's in-flight work, not this lane).
- Item 5: the old eslint FAIL row was this branch's `wow-common.module.ts` max-lines; lane-check labels the eslint row
  with the first changed file (`hub-registration-scan.ts`). Row now PASS.
