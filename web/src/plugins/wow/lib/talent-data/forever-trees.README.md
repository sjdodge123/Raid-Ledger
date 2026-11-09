# forever-trees.json

Static WoW: Forever talent table for all 9 classes (ROK-2146).

- Source: Wowhead's Forever talent calculator, `https://www.wowhead.com/forever/talent-calc/<slug>` for `warrior paladin hunter rogue priest shaman mage warlock druid`.
- Extracted: 2026-11-08, by hand in a browser (read-only, signed out).
- Shape: `{ "<class>": { "hashVersion", "trees": [ { "name", "talents": [ { "spellId", "name", "row", "col", "maxRank", "icon", "prereqSpellId", "descriptions" } ] } ] } }`, talents sorted by row then col. `row` 0-6, `col` 0-3. `icon` is the Wowhead icon file name without extension. `descriptions` is the per-rank tooltip text (index 0 = rank 1, length = `maxRank`), plain text with `\n` line breaks, never HTML. `hashVersion` is the Wowhead calculator build-string version the table was extracted with (ROK-2150).

## Method (DOM selectors)

- Trees: every `.ctc-tree` in page order; the tree name comes from `.ctc-tree-header` (text minus the "0 / 51" counter).
- Talents: every `.ctc-tree-talent`: `data-row`, `data-col`, `data-max-points` (max rank); spell id from the inner `a[href*="/forever/spell="]`; name from `window.g_spells[spellId].name_enus` (fallback: the link slug); icon from the filename in the `ins[style*="background-image"]` URL.
- Prerequisites: each `.ctc-tree-talent-arrow` has `data-row`, `data-col`, `data-size` and points down. The talent at (row, col) is the source and the talent at (row + size, col) the target; the target's `prereqSpellId` is the source's spell id, else null.

Re-extract on a Forever talent patch. Wowhead's `ctc-*` class names are not a contract and may change.

## Tooltip text + hashVersion (ROK-2150)

Forever reuses one spell id for every rank of a talent, so Wowhead's spell tooltip cannot show per-rank values. The per-rank `descriptions` and `hashVersion` come from Wowhead's Forever calculator data instead.

- Source: `https://nether.wowhead.com/forever/data/talents-classic?dv=34&db=1794018043` (a `WH.setPageData("wow.talentCalcClassic.classicplus.data", {...})` script; `hashVersion` was `vkndmh`).
- Extracted: 2026-11-09, by `node scripts/extract-forever-talent-descriptions.mjs <saved-data.js>`. The script matches every talent here by tree + row + col, checks the name, converts the HTML to plain text, rewrites this JSON and the warrior spec fixture (`../__fixtures__/forever-warrior-trees.json`), and fails without writing on any unmatched talent or missing rank. It is idempotent.
- Re-run it whenever the table is re-extracted, and keep `hashVersion` in step: Wowhead translates an older-version build string, so the stamp must be the version the row/col layout was taken from.
