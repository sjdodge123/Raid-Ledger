# forever-trees.json

Static WoW: Forever talent table for all 9 classes (ROK-2146).

- Source: Wowhead's Forever talent calculator, `https://www.wowhead.com/forever/talent-calc/<slug>` for `warrior paladin hunter rogue priest shaman mage warlock druid`.
- Extracted: 2026-11-08, by hand in a browser (read-only, signed out).
- Shape: `{ "<class>": { "trees": [ { "name", "talents": [ { "spellId", "name", "row", "col", "maxRank", "icon", "prereqSpellId" } ] } ] } }`, talents sorted by row then col. `row` 0-6, `col` 0-3. `icon` is the Wowhead icon file name without extension.

## Method (DOM selectors)

- Trees: every `.ctc-tree` in page order; the tree name comes from `.ctc-tree-header` (text minus the "0 / 51" counter).
- Talents: every `.ctc-tree-talent`: `data-row`, `data-col`, `data-max-points` (max rank); spell id from the inner `a[href*="/forever/spell="]`; name from `window.g_spells[spellId].name_enus` (fallback: the link slug); icon from the filename in the `ins[style*="background-image"]` URL.
- Prerequisites: each `.ctc-tree-talent-arrow` has `data-row`, `data-col`, `data-size` and points down. The talent at (row, col) is the source and the talent at (row + size, col) the target; the target's `prereqSpellId` is the source's spell id, else null.

Re-extract on a Forever talent patch. Wowhead's `ctc-*` class names are not a contract and may change.
