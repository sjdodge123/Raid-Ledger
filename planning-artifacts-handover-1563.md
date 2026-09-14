# ROK-1563 — Handover (dev-1563)

Branch `feat/rok-1563-wow-forever-variant` in `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1563`.
NOT pushed, no PR, no migration, no fleet run.

## State: GREEN — all four ACs implemented; every touched spec passes.

Commits:
1. `feat(wow): ROK-1563 — contract enum + API wiring for the wow_forever variant`
2. `feat(wow): ROK-1563 — web variant table, labels, pickers and Wowhead fallback`
3. (final) lint/prettier cleanup + test-helper extraction

## Gates run
- `api`: jest on the 6 touched/adjacent specs → 48 passed.
- `web`: vitest on `wow-era.test.ts`, `wowhead-urls.test.ts`, `utils.test.ts` → 48 passed.
- `npx tsc --noEmit -p api/tsconfig.json` (from repo root) → clean.
- `npm run build -w web` → clean.
- `npx eslint` on every touched file → 0 errors (only pre-existing `max-lines-per-function` warnings).
- `npm run build -w packages/contract` run after the enum change.
- NOT run (deliberately, per brief): full api/web suites, validate-ci, Playwright, Discord smoke.

## Every file changed
Contract
- `packages/contract/src/characters.schema.ts` — `WowGameVariantSchema` gains `'wow_forever'`.

API
- `blizzard.constants.ts` — new exported `WOW_FOREVER_NAMESPACE_PREFIX = 'classicforever'`
  (PLACEHOLDER, documented) + `variantToNamespacePrefix` entry. Single point of change for ROK-1562.
- `blizzard-instance.helpers.ts` — `filterByVariant`: Forever joins the `Classic`-only branch.
- `boss-encounters.controller.ts`, `dungeon-quests.controller.ts` — `VALID_VARIANTS` + doc line.
- `boss-encounters.service.ts`, `dungeon-quests.helpers.ts` — `VARIANT_EXPANSIONS.wow_forever = ['classic']`.
- Specs: `blizzard.constants.spec.ts` (AC1 + AC4), new `blizzard-instance.helpers.spec.ts`,
  `characters.service.operations.spec.ts` (AC1 DTO parse + AC3 404).

Web
- `lib/wow-era.ts` — `WowVariant` union, `WOW_SLUG_TABLE['world-of-warcraft-forever']`
  (`variant: 'wow_forever', era: 'vanilla', fixedClassic: true`), new exported `WOW_FOREVER_LABEL`.
- `lib/wowhead-urls.ts` — `wow_forever` + `classicforever` → classic domain (JSDoc says why).
- `components/profile/CharacterCard.tsx`, `components/characters/character-card-compact.tsx` —
  `wow_forever: 'Forever'`.
- `slots/character-create-import-form.tsx`, `slots/character-create-inline-import.tsx` — picker option
  using the single `WOW_FOREVER_LABEL`.
- `slots/profile-character-actions.tsx` — refresh DTO type union.
- `slots/boss-loot-panel.tsx`, `slots/quest-prep-panel.tsx` — `slugToVariant` case for
  `world-of-warcraft-forever`.
- `components/item-detail-modal.tsx` — Wowhead switch.
- `plugins/wow/utils.test.ts` — `WOW_SLUGS.size` 5 → 6 (count is derived from the table; this is a
  required update, not a weakened assertion) + an explicit membership assertion.

## Reviewer grep — every `classic_anniversary` switch is accounted for
`git grep -n "classic_anniversary" -- api/src web/src packages/contract/src | grep -v spec | grep -v test`
on HEAD returns 25 hits. All are handled:
- 9 are the api/web variant tables + unions listed above — each got a `wow_forever` sibling.
- `web/.../character-create-import-form.tsx:31` and `character-create-inline-import.tsx:64` are the
  *default* variant fallback for the selectable `world-of-warcraft-classic` slug — intentionally
  unchanged (Forever is a `fixedClassic` slug of its own, never the default).
- `api/src/drizzle/schema/characters.ts:69` and `wow-era.ts:9` are comments only.
- Remaining hits are the per-variant branches Forever does not join (TBC domain / TBC expansion set).

## Two deliberate non-changes — need an operator/reviewer decision
1. **No seed-games entry.** `api/scripts/seed-games.ts` was NOT touched. The brief allowed the Forever
   entry only if a real IGDB id is discoverable; it is not (WoW: Forever is unreleased). Note that the
   Anniversary entry in the same file ships with `igdbId: null`, so an entry *could* follow that
   precedent with `apiNamespacePrefix: WOW_FOREVER_NAMESPACE_PREFIX` — but seed-games runs on every
   boot, so adding it makes "WoW: Forever" appear in the production games catalog immediately. That is
   a product-visible launch decision, not an implementation detail, so it is left out.
   **Consequence:** until the game row exists, an import with `gameVariant: 'wow_forever'` fails at
   `resolveGameByVariant` with `NotFoundException('Game not found in the games catalog')` rather than
   reaching Blizzard. Still a clean 404-class error, no crash, no retail data — AC3's *behaviour* holds
   — but the Blizzard-404 path itself is covered by the unit test, not by a live import.
   Marker left for ROK-1562 follow-up: search `WOW_FOREVER_NAMESPACE_PREFIX`.
2. **`ALL_WOW_GAME_SLUGS`** (`api/src/plugins/wow-common/manifest.ts`) was not extended, since it lists
   slugs of seeded games and there is no Forever row yet. Add it in the same change as the seed entry.

## Next steps
1. Operator ruling on the seed-games entry (item 1 above) — that is the only thing between this branch
   and a fully live Forever import.
2. `./scripts/validate-ci.sh --static` (or a fleet `rl_validate_ci`) then `/push`. The diff touches
   `packages/contract/**`, so per CLAUDE.md the gate should escalate to `--full`.
3. When ROK-1562 finds the real namespace: change the one string in `WOW_FOREVER_NAMESPACE_PREFIX`,
   drop the "(API pending)" suffix from `WOW_FOREVER_LABEL`, and revisit the Classic-only instance
   filter once the 9 new dungeons / 2 new raids are published.
