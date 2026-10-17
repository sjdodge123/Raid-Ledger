---
spike: WoW: Forever — Wowhead + related integrations for the Armory (character) page
date: 2026-10-04
base: origin/main @ 646cc9294
author: spike lane (Opus), READ-ONLY on repo + Linear; web/Linear content treated as untrusted data
related: ROK-1562, ROK-1563 (shipped), ROK-1715, ROK-1716, ROK-1717, ROK-1718 (spec), ROK-1719, ROK-1721, ROK-1722, ROK-1723, ROK-1724, ROK-1725, ROK-255/256
status: PROPOSAL. Nothing filed. Stories in section 5 are drafts for the operator to rule on.
---

> **Source:** `planning-artifacts/WOW-FOREVER-INTEGRATIONS-SPIKE-2026-10-04.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-04
> **Linear:** ROK-1726, ROK-1727

# WoW: Forever — Wowhead & related integrations spike

## 0. TL;DR

1. **Wowhead has a Forever database, and it is NOT the Classic one.** The tooltip script (`wow.zamimg.com/js/tooltips.js`, fetched 2026-10-04) defines `WH.dataEnv.CLASSICPLUS = 16`, URL selector `"forever"`, key `"classicplus"`, alias `"classic-plus"`. Pages live at `https://www.wowhead.com/forever/item=<id>` (verified: Thunderfury page), plus `/forever/spell=`, `/forever/talent-calc/<class>`, `/forever/database`.
2. **Item IDs: vanilla IDs carry over; new Forever items have new high IDs that exist ONLY in the Forever env.** Probed `nether.wowhead.com/tooltip/item/<id>?dataEnv=N` (the endpoint the script calls):
   | item | dataEnv 16 (Forever) | dataEnv 4 (Classic) | dataEnv 1 (retail) |
   |---|---|---|---|
   | 19019 Thunderfury | found, **different stats** (no +16–30 Nature dmg, 41.84 DPS vs 53.95) | found | found (ilvl 40 retail version) |
   | 6448 / 2041 / 1121 (low-level vanilla blues) | found | found | — |
   | 16922 T2 legs, 18832 Brutality Blade, 13965, 11815 (lvl-60 vanilla) | **Entity not found** | found | — |
   | 234819 Demonic Gauntlet, 284716 Band of the Better Half, 271940 Theramore Gauntlets (new Forever items) | **found** | **not found** | **not found** |
   Why the gaps: Blizzard encrypted ~12.5k item records and moved stats server-side; Wowhead's Forever DB fills in as players discover items (Icy Veins / foreverchanges.pro, Sept 2026). Beta cap is 30, so most 60 content is still hidden.
3. **Consequence: today's mapping is wrong for Forever.** `wowhead-urls.ts:29-31` and `item-detail-modal.tsx:55-57` send `wow_forever` to the Classic domain. A new Forever item (the gear an addon import will mostly contain after launch) then gets a dead Wowhead link and no tooltip, and a changed vanilla item shows Classic stats.
4. **Recommended rule:** Forever item -> `domain=forever` / `www.wowhead.com/forever/...` **primary**, with a **per-item fallback to Classic** when Wowhead's Forever env does not have the item yet. The fallback has to be decided per item. That needs a small server-side resolver/cache (section 4.2) or an accepted "no tooltip until Wowhead has it" gap (Q1).
5. **Other sites:** Raider.IO has no Forever support (none found; it is a retail M+ product). Warcraft Logs has **no Forever announcement found** (searched 2026-10-04). **foreverlogs.gg** is a community Forever log site with its own uploader and companion addon (community, unverified longevity). ROK-1725 (event report-link field) already covers "paste a WCL / foreverlogs URL". No other WoW link-outs exist in the code besides Wowhead and the Blizzard armory profile URL.
6. **The Forever character page can ship before the Blizzard API.** Equipment and talents render from `characters.equipment` / `characters.talents` jsonb, and `EquipmentWithItems` renders whenever `equipment` is non-null (not gated on Armory). ROK-1724's addon `char` import needs to write those two columns in the existing contract shapes. It must also **not** set `lastSyncedAt`, because `isArmoryImported = !!lastSyncedAt` (`character-detail-page.tsx:193`) turns on the Blizzard Refresh action.

## 1. Provenance

| Source | Used for |
|---|---|
| Lead brief 2026-10-04 (operator request quoted) | scope |
| `docs/spikes/rok-1718-forever-character-identity.md` (Option B: `ruleset` column, full two-part `name`, `region`, realm NULL) | identity interplay |
| `docs/spikes/wow-forever-addon-spike.md` (export string `!RL1!char!…`; `gear` = 19 x `{slot,itemId,link,ilvl}`, `talents` = `{configId, importString?, nodes}` from `C_Traits`) | addon payload shape |
| `docs/spikes/wow-forever-api-research.md` | namespace status (`classicforever` placeholder, 403) |
| Linear `list_issues query=Forever` (titles + status only; bodies not read) | story map: 1562, 1715–1725 all Backlog |
| `wow.zamimg.com/js/tooltips.js` + `nether.wowhead.com/tooltip/...` probes, 2026-10-04 | Wowhead env/ID facts (primary evidence, Wowhead's own script and endpoint; not a documented API) |
| Web (cited inline, all fetched 2026-10-04) | context |

Not reached: the Linear issue BODIES of ROK-1719/1721/1722/1724 (titles only). Wowhead's Forever talent-calc URL/string format (the page answers 403 to curl; WebFetch confirmed only the title "Paladin Forever Talent Calculator").

## 2. Inventory — what we support for WoW Classic/Era/Anniversary today

All anchors are on origin/main @ 646cc9294 and were grepped while this was written.

| # | Integration | Where (file:line) | How it is keyed per variant | What Forever needs |
|---|---|---|---|---|
| I1 | **Wowhead tooltip script** | `web/index.html:21-22` (`whTooltips = {colorLinks, iconizeLinks:false, renameLinks:false}`, async `tooltips.js`); `web/src/plugins/wow/hooks/use-wowhead-tooltips.ts:26-39` (`refreshLinks()` after render, skipped <=768px, ROK-921) | global, one script for all variants | nothing; the script already knows env 16 |
| I2 | **Wowhead URL + `data-wowhead` helper** (declared single source of truth) | `web/src/plugins/wow/lib/wowhead-urls.ts:21-35` `getWowheadDomain` (variant or namespace prefix -> `{urlBase, tooltipDomain}`); item/quest/NPC-search/talent-calc builders `:38-137` | `classic_anniversary`/`classicann` -> `/tbc`; `classic`, `classic_era`, `classic1x`, **`wow_forever`, `classicforever`** -> `/classic` + `domain=classic&dataEnv=1`; else retail | **New branch** `wow_forever`/`classicforever` -> `www.wowhead.com/forever` + `domain=forever`, with a per-item Classic fallback (4.2) |
| I3 | **Duplicate, drifted URL helper** | `web/src/plugins/wow/components/item-detail-modal.tsx:47-63` local `getWowheadUrl` (uses `classic.wowhead.com`, a legacy host) and the "View on Wowhead" link `:149` | own switch, already disagrees with I2 | delete it and call I2 (`getWowheadItemUrl`) |
| I4 | **Equipment grid** (character page) | `web/src/plugins/wow/slots/equipment-grid.tsx:32-37` icon `<img src={item.iconUrl}>` with a placeholder box when absent; `:53-54` `QUALITY_COLORS`/`QUALITY_BORDERS` by `item.quality.toUpperCase()`; `:85-87` Wowhead link + `data-wowhead` (desktop only) | `gameVariant` -> I2 | works as-is once equipment jsonb is filled and I2 is fixed. Needs `iconUrl` from somewhere (I7/4.2) |
| I5 | **Item comparison** | `web/src/plugins/wow/components/item-comparison.tsx:84-94` | `gameVariant` -> I2 | follows I2 |
| I6 | **Fallback tooltip** when the Wowhead script is missing | `web/src/plugins/wow/components/item-fallback-tooltip.tsx:23`; data from `EquipmentItemSchema.stats/armor/weapon/...` (`packages/contract/src/characters.schema.ts:17-57`) | variant-agnostic | addon gear has no stats, so the fallback shows name/ilvl/slot only unless 4.2 caches Wowhead's tooltip |
| I7 | **Blizzard item icons** (Game Data media) | `api/src/plugins/wow-common/blizzard-equipment.helpers.ts:24-75` fetch `item.media.key.href` -> `render.worldofwarcraft.com/us/icons/56/<file>` | namespace from the game row | unavailable for Forever until ROK-1716/1722 (namespace 403) |
| I8 | **Blizzard namespace map** | `api/src/plugins/wow-common/blizzard.constants.ts:184-194` `WOW_FOREVER_NAMESPACE_PREFIX = 'classicforever'` (placeholder); `:200-206` `variantToNamespacePrefix`; `:216-227` `getNamespacePrefixes` | variant -> prefix | ROK-1717 makes it runtime-configurable |
| I9 | **Armory import gate** | `web/src/plugins/wow/lib/armory-import.ts:11-20` (`ARMORY_UNSUPPORTED_VARIANTS = {'wow_forever'}`), `:22-30` picker list | variant set | ROK-1722 drops `wow_forever` |
| I10 | **Slug -> variant/era table** | `web/src/plugins/wow/lib/wow-era.ts:50-79` `WOW_SLUG_TABLE` (Forever = `variant:'wow_forever', era:'vanilla', fixedClassic`); `:85` `WOW_FOREVER_LABEL` | slug | the natural home for the new per-variant integration config (section 4.1) |
| I11 | **Talents** | `web/src/plugins/wow/components/talent-display.tsx:178-193`: retail = pill list; classic = 3-tree summary + Wowhead talent-calc link + **iframe embed** (`:50-66`); string from `web/src/plugins/wow/lib/classic-talent-positions.ts` (**TBC grid positions**, header `:1-9`) | `gameVariant` -> I2 talent-calc URL | Forever talents come from `C_Traits` (addon spike). The shape and the Wowhead Forever talent-string format are **UNVERIFIED**, see 4.3 |
| I12 | **Talent-calc iframe CSP** | `nginx/snippets/security-headers.conf:8` `frame-src … https://www.wowhead.com https://wowhead.com https://classic.wowhead.com`; `img-src` already has `wow.zamimg.com` + `render.worldofwarcraft.com`; `script-src` has `wow.zamimg.com` | global | `/forever/...` is on `www.wowhead.com`, so no CSP change. This is an infra file: **any** CSP edit is its own PR under the infra rules |
| I13 | **Boss loot panel** | `web/src/plugins/wow/slots/boss-loot-body.tsx:82-84` per-item **expansion** -> `getWowheadItemUrlForExpansion` (`wowhead-urls.ts:69-95`: `tbc`/`wotlk`/`cata`/`sod`/`classic`); slug -> variant `boss-loot-panel.tsx:30-42` (Forever -> `wow_forever`) | per item `expansion` | Forever-new loot (ROK-1719) needs an `expansion: 'forever'` value + a `forever` case |
| I14 | **Boss/quest data + loot JSON** | `api/src/plugins/wow-common/boss-encounters.service.ts:31` and `dungeon-quests.helpers.ts:31` (`wow_forever: ['classic']`); `blizzard-instance.helpers.ts:150-160` (Forever = Classic instance set); `data/boss-loot-data.json` (icons on `wow.zamimg.com/images/wow/icons/large/…` and `render.worldofwarcraft.com`); `dungeon-quests.helpers.ts:151-212` Wowhead-enriched quest reward JSON | variant -> expansions list | ROK-1719 adds Forever instances + `forever` expansion rows |
| I15 | **Class / profession icons** | `web/src/plugins/wow/lib/class-icons.ts:7` (`render.worldofwarcraft.com/us/icons/56`); `profession-icons.ts:16+` | static | same icons; nothing needed (Forever has 9 vanilla classes) |
| I16 | **Item quality colours** | `equipment-grid.tsx:53-54`; `item-comparison.css:119-131`; `quest-prep-panel.css:548-585`; `wow-item-card.tsx:50` (accepts any case) | quality string | addon item links carry `|cffXXXXXX` colour, and Wowhead tooltip JSON has `quality: 0-5`. Map to the `POOR…LEGENDARY` strings. **Pre-existing:** several of these are hardcoded colours, outside this spike |
| I17 | **Armory profile link-out** | `api/src/plugins/wow-common/blizzard-profile.helpers.ts:59` (`worldofwarcraft.blizzard.com/en-<region>/character/<realm>/<name>`); rendered via `character-detail-header-badges.tsx:24` | realm + name | realmless Forever URL is UNKNOWN (ROK-1718 U4). Hide until ROK-1722 |
| I18 | **Raider.IO / Warcraft Logs** | **extension point only**: `api/src/plugins/plugin-host/extension-points.ts:75-85` (enricher interface), `api/src/drizzle/schema/enrichments.ts:23`; admin card test fixture `web/src/components/admin/admin-nav-data.test.ts:195`. **No enricher is implemented** | — | nothing to port. ROK-255/256 (WCL) are Backlog. ROK-1725 covers report links |
| I19 | **Variant labels** | `web/src/components/profile/CharacterCard.tsx:23`, `web/src/components/characters/character-card-compact.tsx:23` (`wow_forever: 'Forever'`); contract enum `packages/contract/src/characters.schema.ts:266` | duplicated label maps | fold into the config table (4.1) |
| I20 | **CurseForge** | none in code (grep empty) | — | n/a |

**Pre-existing defects found in passing (for the Lead to log in TECH-DEBT-BACKLOG.md; this lane is write-one-file):**
- `item-detail-modal.tsx:47-63` duplicates and drifts from `wowhead-urls.ts` (`classic.wowhead.com` vs `www.wowhead.com/classic`). The `wowhead-urls.ts:4-7` header claims single-source-of-truth. low.
- `wowhead-urls.ts:26-31` maps variant `classic` (Cata Classic per `armory-import.ts:25`) to the **vanilla** `/classic` DB. Cata items would need `/cata`. med (wrong tooltips for Cata Classic chars). UNVERIFIED whether `classic` is still Cata in prod data.
- `classic-talent-positions.ts:1-9` holds TBC grid positions, and `talent-display.tsx:178-193` uses them for every classic variant including `classic_era`. Vanilla trees have fewer rows/talents, so Era builds may encode wrongly. med, UNVERIFIED (not tested against a real Era character).

## 3. Research — Wowhead and friends for Forever (all fetched 2026-10-04)

| Fact | Source | Kind |
|---|---|---|
| Wowhead runs a Forever section: news, guides, quest DB, talent calculator, `/forever/database` | https://www.wowhead.com/forever ; https://www.wowhead.com/forever/database ; https://www.wowhead.com/forever/guide/overview-features-zones-raids | official (Wowhead) |
| Tooltip script: `dataEnv.CLASSICPLUS=16`, `dataEnvKey[16]="classicplus"`, selector `[CLASSICPLUS]:"forever"`, alias `"classic-plus"`. `Ue()` resolves `data-wowhead … domain=<x>` against key OR selector, so **`domain=forever`** (and `domain=classicplus`) select env 16. Inactive envs fall back to the root env | https://wow.zamimg.com/js/tooltips.js | primary (Wowhead code) |
| Item pages at `/forever/item=<id>`; spells at `/forever/spell=<id>/<slug>` (seen in tooltip HTML `href="/forever/spell=133/fireball"`) | https://www.wowhead.com/forever/item=19019 ; nether tooltip JSON | primary |
| Forever talent calculator exists at `/forever/talent-calc/<class>` (title "Paladin Forever Talent Calculator"). Build-string/embed format **not observed** | https://www.wowhead.com/forever/talent-calc/paladin | primary, partial |
| ID space: vanilla IDs reused (19019, 6448, 2041, 1121 resolve in env 16). New Forever items use high IDs (234819, 271940, 284716) that resolve **only** in env 16 | nether probes above; names from https://foreverchanges.pro/items | primary + community |
| Many lvl-60 vanilla items are **not yet** in env 16 (16922, 18832, 13965, 11815) | nether probes | primary |
| ~12.5k items shipped encrypted, stats server-side; Wowhead and fan DBs reveal them as players find them | https://www.icy-veins.com/wow-forever/news/wow-forever-hid-over-12500-items-from-dataminers-heres-whats-still-secret/ ; https://foreverchanges.pro/hidden-items | community |
| Tweaked vanilla items have Forever-specific stats on Wowhead (Thunderfury differs between env 16 and 4) | nether probes | primary |
| Forever runs the **retail client** (Interface 16001, `WOW_PROJECT_MAINLINE`, `C_Item`, talents on `C_Traits`) | addon spike section 2.2 (forever-addon-kit, wowforeverguides) | community, beta |
| Icons: Wowhead tooltip JSON returns an `icon` name (e.g. `inv_sword_39`). `https://wow.zamimg.com/images/wow/icons/large/<icon>.jpg` answers 200 and is already in our CSP `img-src` and in `boss-loot-data.json` | probe | primary |
| Warcraft Logs: no Forever support announcement found | search 2026-10-04 (no hit; https://www.wowhead.com/forever/news?tag=warcraftlogs list did not render) | UNVERIFIED |
| foreverlogs.gg: community Forever log site with uploader + `/combatlog` companion addon | https://foreverlogs.gg/ ; https://github.com/FangYuanWoW/forever-logs-companion | community |
| Raider.IO: no Forever support found | search 2026-10-04 | UNVERIFIED (absence) |
| Community DBs (ForeverDB, thewowdb, wow-forever.gg) exist. Not candidates: no tooltip script, unknown stability | https://foreverdb.net/ ; https://thewowdb.com/wow-forever/item/ | community |

**Caveat:** `nether.wowhead.com/tooltip/...` is the undocumented endpoint behind Wowhead's public tooltip widget. Server-side use (4.2 option R) is a terms/etiquette question, see Q2.

## 4. Design

### 4.1 One variant-integration config table (adding a variant is data, not code)

Today the variant -> site mapping lives in at least five switches: `wowhead-urls.ts:21-35`, `wowhead-urls.ts:69-83` (expansion), `item-detail-modal.tsx:47-63`, `boss-loot-panel.tsx:30-42` (plus the near-copy in `quest-prep-panel.tsx:39`), and the label maps (I19). Proposal: extend `WOW_SLUG_TABLE`'s sibling with a **variant-keyed** table in a new `web/src/plugins/wow/lib/wow-variant-config.ts` (new file):

```ts
export interface WowVariantIntegrations {
  label: string;                         // 'Forever', 'Classic Era / SoD', …
  wowhead: { path: string; domain: string; fallback?: WowVariantKey }; // forever: {path:'forever', domain:'forever', fallback:'classic_era'}
  talentCalc: 'classic3tree' | 'retailTraits' | 'foreverTraits' | null;
  armoryImport: boolean;                 // replaces ARMORY_UNSUPPORTED_VARIANTS
  namespaceAliases: string[];            // 'classicforever', 'classic1x', … (I2 accepts both forms)
  logs?: { name: string; urlPattern: RegExp }[]; // ROK-1725: WCL / foreverlogs.gg recognisers
}
export const WOW_VARIANT_INTEGRATIONS: Record<WowVariant, WowVariantIntegrations> = { … };
```
`getWowheadDomain`, the expansion map (add `forever`), the item-modal URL, `isArmoryImportSupported` and the label maps all derive from it. A unit test asserts every `WowVariant` has an entry, so the type plus the test make "forgot Forever" a compile/test error. The API side keeps its own `variantToNamespacePrefix` (ROK-1717 already owns making it runtime). Do not share across workspaces unless the contract already carries the variant enum (it does, `characters.schema.ts:266`). **Lead decision needed:** web-only table (recommended, smallest) vs contract-level table.

### 4.2 Item display from addon-imported IDs (no Blizzard API)

Input per item (ROK-1724 `char.gear`): `{ slot, itemId, link, ilvl }`. The link carries the coloured name (`|cffa335ee|Hitem:…|h[Name]|h|r`), which gives the **name and quality colour** with no lookup. The server already strips escapes (addon spike 4c step 6). It should also parse quality from the colour code into the `POOR…LEGENDARY` string.

Map to `EquipmentItemSchema` (`characters.schema.ts:17-57`): `slot` (normalise addon slot ids to the Blizzard slot names `equipment-constants.ts` orders by), `name`, `itemId`, `quality`, `itemLevel = ilvl`, `itemSubclass: null`, `iconUrl` (see below), and leave stats undefined. Write it to `characters.equipment` with `syncedAt = exportedAt` and `equippedItemLevel` = average. **Do not touch `lastSyncedAt`.** Add a provenance marker so the UI can say "via addon · <date>" (addon spike story "addon snapshot section"). That needs either a contract field (`equipment.source: 'armory'|'addon'`, optional, so not breaking) or a sibling column. Recommend the optional field. It is a `packages/contract` change, so standard tier and `--full` gate.

**Tooltip + link resolution (the core question).** Three options:

| Option | How | Pros | Cons |
|---|---|---|---|
| **S — script only, Forever env** | `data-wowhead="item=<id>&domain=forever"`, link `/forever/item=<id>` | zero backend; correct for new Forever items and tweaked vanilla items | hidden lvl-60 items show **no tooltip** and the link 404s until Wowhead learns them (likely most raid gear for weeks after launch) |
| **R — server resolver + cache (RECOMMENDED)** | on import (and a daily retry), the API GETs `nether.wowhead.com/tooltip/item/<id>?dataEnv=16`. If not found, it tries `dataEnv=4`, then stores `{itemId, env, name, quality, icon, fetchedAt}` in a small `wow_item_meta` cache table (migration). The DTO gains `wowheadEnv` per item, and the web builds `domain=` + URL from it. `iconUrl` = `wow.zamimg.com/images/wow/icons/large/<icon>.jpg` (already CSP-allowed) | correct link + tooltip for every item, icons without Blizzard, self-heals as Wowhead fills in | one migration + a fetch helper. Relies on an undocumented endpoint (Q2). Needs a rate limit and backoff |
| **C — client probe** | browser calls nether before deciding the domain | no migration | needs a CSP `connect-src` edit (infra PR), N requests per page view, flicker |

The Option R fallback order is **Forever -> Classic -> render the name-only fallback tooltip (I6)**. Once Blizzard's Forever namespace is live (ROK-1722), Blizzard item media (I7) can replace Wowhead for icons, but Wowhead stays the tooltip source.

### 4.3 Talents from the addon

The addon exports `C_Traits` data (`configId`, `nodes`, optional `importString`). Forever's in-game trees are 3-tree, 51-point vanilla-style trees per the community calculators (classicwowforever.com/talents, talentsforever.com), carried on the retail traits system. **UNVERIFIED:** (a) whether `C_Traits.GenerateImportString` works on Forever, (b) the Wowhead Forever talent-calc URL string format (could not observe it), (c) node-id -> (tree,row,col) mapping. Plan:
- **Phase 1 (pre-launch safe):** store the raw `talents` payload in `characters.talents` under a new discriminant `{ kind: 'forever-traits', configId, nodes: [{nodeId, rank, name?}], importString? }`. Add a `ForeverTalentDisplay` branch to `talent-display.tsx:178` that lists the talents by name (the same pill pattern as `RetailTalentDisplay`, `:149-158`). Link to `wowhead.com/forever/talent-calc/<class>` **without** a build string, and skip the iframe embed.
- **Phase 2 (after beta experiment E-T):** if the Wowhead Forever calc accepts a build string we can derive (from the in-game import string, or nodes -> positions), add it and the embed. CSP is fine (I12).
- Copy-to-clipboard of the in-game `importString` is a cheap win if (a) holds.

### 4.4 Interplay with in-flight Forever work

| Story | Interplay | Ask |
|---|---|---|
| ROK-1721 manual entry (Option B, ROK-1718 spec) | page shows ruleset, not realm; equipment/talent sections show "Import your gear with the Raid Ledger addon" instead of the Armory wording (`character-detail-sections.tsx:97-104` hardcodes "only available for characters imported from the Blizzard Armory") | variant-aware empty-state copy (config table `armoryImport`) |
| ROK-1724 Import string | the gear/talent writer described in 4.2/4.3; must not set `lastSyncedAt` | add AC: equipment jsonb conforms to `EquipmentItemSchema`; `lastSyncedAt` untouched |
| ROK-1723 addon v0 | `gear[].link` must be the full item link (name + colour); slot ids documented | add AC: export includes `link`, `ilvl`, and `GetInventoryItemID` for all 19 slots |
| ROK-1722 Armory import | when live, Armory sync overwrites `equipment` with Blizzard data incl. icons + stats. Need a merge policy between addon and Armory (newest wins? Armory wins?) | Q4 |
| ROK-1719 instances/bosses | Forever loot rows need `expansion: 'forever'` so I13 links to `/forever` | add `forever` case to the expansion map (config table) |
| ROK-1715 cover | none (game cover), independent | — |
| ROK-1725 report link | foreverlogs.gg + classic.warcraftlogs.com URL recognisers belong in the config table `logs` | — |
| ROK-1717 namespace runtime config | web Wowhead mapping must not depend on the namespace prefix string `classicforever` (I2 accepts it today as an alias); keep the alias list in config | — |

## 5. Plan — phased stories (drafts, do not file until ruled)

**Phase 0 — pre-launch, web-only, `trivial`/`standard`-light (ship before 2026-11-04)**
1. **fix(wow): Forever items use Wowhead's Forever database** — `wowhead-urls.ts` `wow_forever`/`classicforever` -> `{urlBase:'www.wowhead.com/forever', tooltipDomain:'forever'}`; `item-detail-modal.tsx:47-63` deleted in favour of `getWowheadItemUrl`. ACs: (a) unit test `getWowheadItemData(234819,'wow_forever') === 'item=234819&domain=forever'`; (b) `getWowheadItemUrl(19019,'classicforever')` -> `https://www.wowhead.com/forever/item=19019`; (c) the item modal "View on Wowhead" uses the shared helper (grep proves no second switch); (d) mutate each assertion. Bug + regression unit test. Single file + modal file = **standard** (two source files) but tiny. **Risk accepted until Phase 1:** hidden lvl-60 vanilla items lose their tooltip (Q1).
2. **refactor(wow): one variant-integration table** (4.1) — `wow-variant-config.ts` + consumers; exhaustiveness test; boss-loot `forever` expansion case. Behavior-neutral except item 1. ~150 lines, standard, `--static`.
3. **feat(wow): Forever-aware empty states on the character page** — variant-aware copy in `character-detail-sections.tsx:97-104` and `talent-display.tsx:166-175`, pointing at the addon/Import string instead of "Blizzard Armory". Hide the Armory profile link for realmless characters. Fleet test plan (both colour families, phone + desktop).

**Phase 1 — with ROK-1724 (launch window)**
4. **feat(characters): addon gear -> equipment** (part of, or a child of, ROK-1724) — mapping in 4.2. ACs: equipment jsonb validates against `CharacterEquipmentSchema`; quality parsed from the link colour; `lastSyncedAt` unchanged (integration test); "via addon · <date>" label; optional `equipment.source`. Contract change -> standard, `--full`.
5. **feat(wow): Wowhead item resolver + cache (Option R)** — migration `wow_item_meta`, fetch helper with Forever->Classic fallback, rate limit (<=1 req/s, backoff, daily retry of `env=4`/not-found rows), `wowheadEnv` + `iconUrl` on DTO items. ACs: a new-Forever ID resolves env 16; a hidden vanilla ID resolves env 4 and is re-probed later; a not-found ID renders the I6 fallback; no browser-side change to CSP. Migration -> `--full`. **Blocked on Q2.**
6. **feat(wow): Forever talents display (phase 1 of 4.3)** — `forever-traits` discriminant + pill display + calc link without a build string.

**Phase 2 — waits on the outside world**
7. Forever talent-calc build string + embed (needs beta experiment E-T and the Wowhead string format).
8. ROK-1722 Armory: Blizzard icons/stats for Forever. Addon-vs-Armory merge policy (Q4).
9. Logs: WCL enricher (ROK-255/256) only if WCL ships Forever. foreverlogs.gg stays a link-out via ROK-1725 (no API found).

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Wowhead Forever env lacks most endgame items at launch (encrypted items) | high | Option R fallback to Classic; Phase-0-only ships with a known gap (Q1) |
| Classic-env fallback shows **Classic stats for a Forever-tweaked item** (Thunderfury pattern) | medium | env 16 is always tried first and re-probed daily, so it self-heals when Wowhead learns the item; label the tooltip source? (Q3) |
| `nether.wowhead.com` is undocumented; could block server traffic or change shape | medium | cache aggressively, degrade to the script-only Option S, set a User-Agent, respect rate limits; ask the operator (Q2) |
| `tooltips.js` renames `forever`/`classicplus` | low | the unit test pins our string; a canary check could fetch the script and grep `CLASSICPLUS` (cheap, optional) |
| Two-part names / `UnitName` instability corrupt item->character binding | medium | ROK-1724 binds by GUID + full name (addon spike), not this spike's concern |
| Talent format unknown | high | Phase-1 display is name-only; no build string until verified |
| Addon import sets `lastSyncedAt` and exposes a Blizzard Refresh that 403s | medium | explicit AC in ROK-1724 (story 4) |
| CSP drift if anyone picks Option C | low | do not; Option R keeps the browser untouched |

## 7. Operator questions (each with a recommendation)

1. **Pre-launch: switch Forever links/tooltips to `domain=forever` now (Phase 0 item 1), accepting that hidden lvl-60 vanilla items have no tooltip until the resolver lands?** Recommend **yes**. New Forever gear is what launch characters wear; the old mapping is wrong for all of it.
2. **May the API call Wowhead's tooltip endpoint (`nether.wowhead.com`) server-side, cached, to resolve env/name/quality/icon (Option R)?** Recommend **yes, with a <=1 req/s limit, a long cache, and a kill switch**. The alternative is script-only tooltips with dead links for weeks. If no, fall back to Option S plus the name-only fallback tooltip.
3. **When an item is served from the Classic fallback, show a small "Classic data" hint?** Recommend **no hint** on the tooltip (noise). Do show it in the item modal ("Forever data not yet on Wowhead — showing Classic").
4. **Addon vs Armory precedence once ROK-1722 is live:** recommend **the newest snapshot wins**, with source + date always shown. The Armory may lag a live session, and the addon may be stale.
5. **Config table scope:** recommend **web-only** `wow-variant-config.ts` (4.1). The API keeps its namespace map under ROK-1717. No contract change for the table itself.
6. **Talent display v1 = names only + calc link (no embed) until the Forever string format is proven?** Recommend **yes**.
7. **Log the three pre-existing defects (section 2: modal drift, Cata->vanilla domain, TBC positions for Era) in TECH-DEBT-BACKLOG.md now?** Recommend **yes**. The Lead appends them; this lane was write-one-file. Folding the modal drift into Phase 0 item 1 is justified (same surface).
8. **Raider.IO / WCL:** recommend **no work** until either announces Forever. Keep foreverlogs.gg as a link-out only (ROK-1725).

## 8. Lane self-report

- **Verified:** every repo anchor in section 2 (grepped on 646cc9294). Wowhead env 16 / `forever` selector from the live script. Item ID behaviour by direct tooltip-endpoint probes (11 IDs, 3 envs). Icon CDN 200.
- **Flagged UNVERIFIED:** Wowhead Forever talent-calc string/embed format; WCL/Raider.IO Forever support (absence of evidence); whether `classic` variant = Cata in prod; TBC-vs-vanilla talent positions for Era; C_Traits import-string availability; Wowhead endpoint terms.
- **Not reached:** Linear issue bodies of ROK-1719/1721/1722/1724 (titles only); design-system section citations for the Phase 0 item 3 empty-state copy (reuse the existing empty-state pattern in `character-detail-sections.tsx`, no new pattern expected).

## Operator rulings — 2026-10-04
- Q1: **Switch Forever to `domain=forever` now** (Phase 0), accepting no tooltip for Blizzard-hidden lvl-60 items until the resolver lands.
- Q2: **Yes** — server-side Wowhead tooltip-endpoint resolver (Forever → Classic fallback), ≤1 req/s, long cache, admin kill switch; item modal shows "Forever data not yet on Wowhead — showing Classic" on fallback (no tooltip hint).
- Q4: newest snapshot wins (addon vs Armory), source + date always shown. Q5: web-only `wow-variant-config.ts`. Q6: talents v1 = names + calc link, no embed. Q8: no Raider.IO/WCL work until they announce Forever; foreverlogs.gg link-out only (ROK-1725).
- Q7: log the three pre-existing defects in TECH-DEBT-BACKLOG.md (Lead appends with the next batch commit).
