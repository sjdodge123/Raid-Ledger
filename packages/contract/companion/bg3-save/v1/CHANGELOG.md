# Raid Ledger Companion `bg3-save` — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.
Display-table edits (`src/companion-bg3-display.ts`) are not wire and get no
entry.

## v1 — 2026-10-25 (additive) — initial contract

- **Additive.** New folder `packages/contract/companion/bg3-save/v1/` and
  registry entry `bg3-save` v1 (ROK-1954). No existing contract changes:
  `ledgerlink/` and `valheim-link/` are untouched.
- Payload: `saveName`, `savedAt`, `campaignKey`, `campaignKeySource`,
  `gameVersion`, `platform`, `currentLevel`, `difficulty`, `ruleset`,
  `party[]` (`origin`, `race`, `level`, `xpLevel`, `xpTotal`,
  `classes[{ main, sub }]`, `isSummon`) and a nullable WebP `thumbnail` ref.
  Every object is strict; four refinements (§5).
- Reference normaliser `normaliseBg3SaveInfo` and the loose raw
  `Bg3SaveInfoRawSchema`; `Position` and `Subregion` are dropped and never
  sent.
- `campaignKey` is a SHA-256 of the save-folder name, never the raw name. It
  fragments campaigns across saves; grouping by `meta.lsf` GameID is
  ROK-1967 (`campaignKeySource: "game-id"`).
- Fixtures: anonymised `SaveInfo.json` from the operator's save plus synthetic
  cases and a synthetic placeholder WebP (operator ruling 5). The real
  thumbnail is not in the repo.
