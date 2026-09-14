# ROK-1563 — feat: add the `wow_forever` WoW game variant now (Blizzard namespace pending)

Operator ruling 2026-09-14: "go ahead and add the new game variant pending more info." The Battle.net
namespace for WoW: Forever does NOT exist yet (beta 2026-09-17, launch 2026-11-04), so this story wires
the variant everywhere the code switches on one, with the namespace behind a single constant that flips
the day Blizzard publishes it.

## Scope (all the places that switch on a variant today — from `git grep classic_anniversary`)

**Contract** — `packages/contract/src/characters.schema.ts:260` `WowGameVariantSchema`: add `'wow_forever'`.

**API**
- `api/src/plugins/wow-common/blizzard.constants.ts:187` `variantToNamespacePrefix`: `wow_forever →
  WOW_FOREVER_NAMESPACE_PREFIX`, a new exported constant `= 'classicforever'` with a comment:
  PLACEHOLDER — Blizzard has not published the Forever namespace; replace when ROK-1562's probe finds it.
  A wrong prefix 404s loudly (same as Anniversary professions today); it never silently reads retail
  data, which is what mapping to `null` would do.
- `api/src/plugins/wow-common/blizzard-instance.helpers.ts:149` instance filter: Forever = `Classic`
  expansion only (its 9 new dungeons / 2 raids come later — note in code).
- `boss-encounters.controller.ts:32` / `boss-encounters.service.ts:26` / `dungeon-quests.controller.ts:32`
  / `dungeon-quests.helpers.ts:27`: accept the variant; map to `['classic']`.
- `api/src/games-lookup/seed-games.helpers.ts` + the WoW seed list it reads: add the Forever entry with
  `apiNamespacePrefix: WOW_FOREVER_NAMESPACE_PREFIX` ONLY if the real IGDB id is discoverable via the
  existing lookup; never invent an id. NO migration.

**Web**
- `web/src/plugins/wow/lib/wow-era.ts`: `WowVariant` union + `WOW_SLUG_TABLE` entry
  `'world-of-warcraft-forever': { variant: 'wow_forever', era: 'vanilla', fixedClassic: true }`.
- Labels: `web/src/components/profile/CharacterCard.tsx:19`,
  `web/src/components/characters/character-card-compact.tsx:19` → `wow_forever: 'Forever'`.
- Pickers: `web/src/plugins/wow/slots/character-create-import-form.tsx:54`,
  `web/src/plugins/wow/slots/character-create-inline-import.tsx:16` → option `WoW: Forever (API pending)`
  via one exported `WOW_FOREVER_LABEL`.
- `slots/profile-character-actions.tsx:58` type union, `slots/boss-loot-panel.tsx:26`,
  `slots/quest-prep-panel.tsx:25`, `components/item-detail-modal.tsx:49` switches.
- `web/src/plugins/wow/lib/wowhead-urls.ts:17`: Forever → the classic domain until Wowhead ships a
  Forever database; comment says so.

## Acceptance criteria
- AC1 `wow_forever` is a valid `gameVariant` on the import DTO; `variantToNamespacePrefix('wow_forever')`
  returns the placeholder constant; `getNamespacePrefixes` builds `static-/dynamic-/profile-classicforever`.
  Unit tests on both.
- AC2 Every web switch above handles the value (exhaustive where a `switch` exists — no fall-through to
  retail). Vitest on `wow-era.ts` and `wowhead-urls.ts`.
- AC3 The import picker lists WoW: Forever; importing with it surfaces a Blizzard 404 as the existing
  "character not found" error (no crash, no retail data). One integration/unit case on the import path
  with the Blizzard client mocked to 404.
- AC4 No behaviour change for the four existing variants (existing specs stay green).
