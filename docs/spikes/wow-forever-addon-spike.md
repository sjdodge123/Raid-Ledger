---
doc: spike — adapt the Classic addon + data-sync plans to WoW: Forever (beta addon dev)
date: 2026-10-04
base: origin/main @ ad1011018 (anchors grepped on this commit)
author: spike lane (read-only on repo + Linear; web + Linear content treated as untrusted data)
inputs: Linear ROK-815/255/256/260/455/1170/1720/1721 (+ ROK-1718 spec, ROK-1562 research doc); web research below
tier of follow-ons: addon = new repo/folder (not in the monorepo gate); server import = STANDARD (contract + migration; a new npm dep only if CBOR is chosen) → `validate-ci.sh --full`, Codex security review mandatory
ruling: OPERATOR RULING 2026-10-04 (relayed by the Lead mid-spike) — data leaves the game as a COPY+PASTE ENCODED EXPORT STRING; Raid Ledger gets an "Import string" spot on the character page. NOT a SavedVariables file upload, NOT a desktop companion for v0. This doc is shaped around that ruling; the SV-upload and companion options survive only as recorded alternatives (4b).
---

> **Source:** `planning-artifacts/WOW-FOREVER-ADDON-SPIKE-2026-10-04.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-04
> **Linear:** ROK-1723, ROK-1724

# WoW: Forever addon + Raid Ledger sync — spike

## 0. TL;DR

1. **The old plan's DPS-from-combat-log idea is dead on the Forever client.** Forever runs the *retail (Midnight-era) client* with Midnight's addon restrictions: `COMBAT_LOG_EVENT_UNFILTERED` throws on register and `CombatLogGetCurrentEventInfo` is gone. Blizzard ships a built-in damage meter (`C_DamageMeter`), but its values are **secret values** in combat and on restricted maps (dungeon/raid). An addon can show them, not compute with them. Whether an addon can read them as plain numbers *after* combat or outside the instance is **UNVERIFIED**. That is experiment E3 in the v0 addon.
2. **DPS still has a path, just not through the addon's Lua.** The client's **`/combatlog` file** (`Logs/WoWCombatLog-<date>.txt`) still works on Forever, and a community site (foreverlogs.gg) already parses it. So per-encounter parses come from **log files**: a third-party site via an API (adapt ROK-255/256), or our own parser later. They do not come from a SavedVariables addon.
3. **What the addon CAN do well:** guild roster snapshot, own gear (item links + ilvl), talents (`C_Traits`), encounter pull/kill/wipe records (`ENCOUNTER_START`/`ENCOUNTER_END`) with the group roster at pull (= attendance), and saved-instance lockouts. All of it is out-of-combat or event-payload data. **Recommend this as the v0 scope.**
4. **Exfil (OPERATOR RULING 2026-10-04): copy+paste export string.** Addons cannot do network I/O. The addon serialises a section (character / guild / raid), compresses and base64-encodes it, then shows it in a copyable edit box (`/rl export …`). This is the WeakAuras / Details / SimC pattern. The player pastes it into an **"Import string"** box on their Raid Ledger character page, and the server decodes, validates and applies it. **Forever's client ships native `C_EncodingUtil` (CBOR/JSON serialise, Deflate/Zlib/Gzip, Base64)**, so the addon needs no bundled libs. The server needs only Node's `zlib` + `Buffer` (+ `JSON.parse`, or a CBOR decoder). SavedVariables is used only as the addon's local buffer, never uploaded. ROK-815 (Electron sync) is **superseded for v0** and deferred to a "maybe later" phase 3.
5. **Identity:** Forever names are two-part (`"First Second"`). The client APIs have **flip-flopped across beta builds** (the surname appeared in the realm slot, then `UnitName` dropped it in 1.60.1.70009). The addon must capture **GUID + raw strings from several APIs** and let the server normalise to the ROK-1718 Option B identity (region + full name, ruleset attribute).

## 1. Existing stories found (Linear, team "Roknua's projects", includeArchived)

Queries run: addon, SavedVariables, Electron, companion, upload, Warcraft Logs, combat log, DPS, guild, Forever. (`Lua`, `parse`, `lockout`, `character sync`, `WoW Classic` hits were covered by the above. No other addon story exists.)

| Story | Status | What it is | Verdict for Forever |
|---|---|---|---|
| **ROK-815** spike: Electron desktop app for WoW addon data sync (2026-03-14) | Backlog | Electron shell wrapping the web UI + SavedVariables file watcher + Lua parser + addon survey (Attune, RCLootCouncil, Details!, DBM/BigWigs, GRM) + API/auth design + optional companion addon on AceComm channels. No comments. | **SUPERSEDED for v0 (operator ruling 2026-10-04: copy+paste export string). DEFER the remainder.** The "own companion addon" becomes the main deliverable (phase 0). The API design becomes the import endpoint (phase 1). The Lua-table parser is no longer needed: the payload is CBOR/JSON, not Lua source. The Electron shell + SV file watcher are deferred to optional phase 3 and are worth doing only if paste friction proves real. The third-party addon survey is mostly void on Forever: Details!/DBM depend on CLEU, and Attune covers TBC attunements, which are irrelevant. Recommend: comment on ROK-815 linking this doc and move it to Backlog/Icebox as "deferred by ruling". |
| **ROK-255** feat: Warcraft Logs API Integration (Epic 3 wow-retail 3/5) | Backlog | WCL v2 GraphQL client, client-credentials OAuth, character parses + guild reports, rate limiting, admin card. | **ADAPT (blocked on a log site).** The DPS path for Forever is log-file based. Re-target to "parse provider" once it is known whether WCL (classic.warcraftlogs) supports Forever or foreverlogs.gg exposes an API. **UNVERIFIED: no WCL Forever announcement found.** Its character lookup is realm-keyed and needs the Forever identity (region + two-part name). Keep for retail/Classic as written. |
| **ROK-256** feat: Warcraft Logs — Character & Event Display (Epic 3 4/5) | Backlog | Parse badges on character/event pages, guild report history. | **KEEP the UI and swap the source.** Display is source-agnostic. It depends on whichever provider ROK-255 lands on. The event-page "report linked from event" works from day one with a manual "paste report URL" field (no API). |
| **ROK-260** feat: Lockout Tracker Framework (Epic 5 1/2) | Backlog | `instance_lockouts` table, reset schedule per region, manual entry, optional WCL auto-populate. | **ADAPT: the addon becomes the best source.** Add `source: 'addon'`. The addon captures `GetSavedInstanceInfo` (UNVERIFIED on Forever, retail global) per character. Forever reset days: **UNVERIFIED**. |
| **ROK-1170** feat: Guild model + Blizzard guild sync (Guild Dashboard epic ROK-1169) | Backlog | `guilds` + `guild_members` tables keyed `(game_id, region, realm_slug, guild_slug)` / `blizzard_guild_id`, fed by the Blizzard API. | **ADAPT the schema, add a second feed.** For Forever there is no API (ROK-1562/1716), so the addon roster snapshot is the *only* roster source at launch. The schema must allow realm-less guilds and a `source` (`blizzard_api` / `addon_import`) per member. Reconcile with ROK-1720 before building. |
| **ROK-1720** spike(wow): guild roster import for Classic flavours (2026-10-04) | Backlog | Roster import UX across Classic flavours; overlap with ROK-1170. | **FOLD IN.** Add "addon export-string import" as a roster source for flavours without an API. This spike answers its Forever half. |
| **ROK-455** feat: Stat-weight % upgrade scoring | Backlog | Item stat weights vs equipped item. | **KEEP for Classic. Forever is a stretch.** It needs equipped-item data. The addon's gear snapshot is the only Forever source of "what's equipped" until an Armory exists. Unblocked by phase 1, not part of it. |
| ROK-1721 / ROK-1718 (Forever manual character entry + identity spike, Option B approved) | Backlog | Defines Forever identity: `name` = "First Second", `region`, nullable `ruleset`, `realm` NULL, unique (game, region, lower(name)). | **DEPENDENCY.** Every addon import binds to this identity (§4c). Ship ROK-1721 first (due 2026-10-30). |
| ROK-1562 / ROK-1716 / ROK-1717 / ROK-1722 | Backlog | Forever API namespace probe + Armory import once live. | **COMPLEMENT.** The addon is the no-API fallback and the richer source (lockouts, encounters) even after an Armory exists. |

Repo grep (`git grep -i "addon|savedvariables|lua"` over `docs/ api/src packages` on origin/main): **no prior addon design, endpoint or parser exists.** `planning-artifacts/` has only the Forever API research doc + ROK-1718 spec.

## 2. Forever addon reality (research, 2026-10-04)

### 2.1 Official (Blizzard)
| Fact | Source | Date |
|---|---|---|
| Forever uses the **modern addon API**, with Midnight's in-combat "addon disarmament" carried over. Blizzard's stated goal: addons help you see the game, not play it. | Kotaku post-BlizzCon interview (Tim Jones / Mike Nuthals), as reported by https://www.masterofwarcraft.net/2026/09/wow-forever-combat-addon-restrictions.html. The developer-Q&A answer is quoted by https://wowsod.pro/articles/wow-forever-addons-weakauras. | 2026-09-16/17 |
| Built-in damage meter, cooldown manager and swing timer; "addons should not be required" | same reporting; https://wofwforever.com/en/guides/wow-forever-built-in-ui-setup/ | Sept 2026 |
| Realmless rulesets + region-unique two-part names | already sourced in `docs/spikes/rok-1718-forever-character-identity.md` §1 (F2–F5) | Sept 2026 |
| **No primary Blizzard API doc for Forever addons was found.** The specifics below are community-observed. | — | — |

### 2.2 Community-observed (beta builds 1.60.x). Treat as volatile.
| Fact | Source | Date |
|---|---|---|
| TOC `## Interface: 16001` (build 1.60.x; product folder `_classic_beta_`). Verify in game: `/dump select(4, GetBuildInfo())` | https://github.com/Thunderz96/forever-addon-kit (updated 2026-09-24); https://wowforeverguides.com/addons/developers (2026-09-28, build 69913); TOC PR https://github.com/bguerre20/AzerothCreatureCompendium/pull/19 | Sept 2026 |
| "It is the Retail client": `WOW_PROJECT_ID == WOW_PROJECT_MAINLINE`, 269 `C_*` namespaces. Classic globals are gone (`GetItemInfo`, `GetSpellInfo`, `UnitAura`, `GetTalentInfo`, `CombatLogGetCurrentEventInfo`). Use `C_Item.GetItemInfo`, `C_Spell.GetSpellInfo` (async: `ITEM_DATA_LOAD_RESULT`). | forever-addon-kit; wowforeverguides | 2026-09-24/28 |
| Talents run on retail `C_Traits` | forever-addon-kit | 2026-09-24 |
| `COMBAT_LOG_EVENT_UNFILTERED` registration throws. The combat log reader is unavailable to addons. | forever-addon-kit; wowforeverguides; https://wowforever.one/guides/addons/ (that page says its details "come from beta testing and forum posts") | Sept 2026 |
| `C_DamageMeter` exists (CurseForge "Forever Details Meter" is built on it "since the combat log is off-limits"). Its source getters have the `SecretArguments` predicate, so they return secret values. | https://www.curseforge.com/wow/addons/forever-meter/files/all ; https://warcraft.wiki.gg/wiki/API_C_DamageMeter.GetCombatSessionSourceFromType | Sept 2026 |
| Secret-value predicates: `SecretWhenInCombat`, **`SecretOnRestrictedMaps` (dungeon/raid even out of combat)**, `SecretWhenEncounterEvent`. Untainted code can treat secrets as normal values. Writing secrets to SavedVariables is undocumented. The page does not say whether secrets lift after combat. | https://warcraft.wiki.gg/wiki/Secret_Values (last edited 2026-09-23) | 2026-09-23 |
| Sources conflict on damage numbers: one says "health is secret during combat; damage numbers are not", others say damage numbers are hidden. → **UNVERIFIED, test in beta (E3).** | forever-addon-kit vs wowforever.one / elyxir.gg | Sept 2026 |
| **`/combatlog` file logging works.** An addon can toggle it (same as typing `/combatlog`) and turn on Advanced Combat Logging, writing to `Logs/WoWCombatLog-<date>.txt`. foreverlogs.gg is a community upload/analysis site (not Warcraft Logs). | https://github.com/FangYuanWoW/forever-logs-companion | Sept 2026 |
| **SavedVariables beta bug:** the client *writes* SV on exit but did not *read them back* on load. One source says it was fixed in 1.60.1.70009; another still lists it as a beta defect. Writing (our exfil path) works either way. | forever-addon-kit; wowforeverguides (says fixed in 70009); wowforever.one | Sept 2026 |
| `ReloadUI()` is protected (use `/reload`). 100 Lua-error cap per session. | forever-addon-kit | 2026-09-24 |
| **Two-part names in client APIs are unstable across builds.** Early beta put the surname in the *realm* slot of `UnitName`/`UnitFullName`, and the `CHAT_MSG_ADDON` sender is `"First Surname"` (space, no `-Realm`). In **1.60.1.70009** `UnitName("player")` returns **only the first name**, while `GetUnitName("player", true)` returns `"First Surname"`. Guild roster names carry `"First Surname-<realm>"`. Advice: identify the player in the roster by **GUID**, and read the realm separately via `GetRealmName()`. | https://github.com/danielcosta42/guildos/issues/26 (2026-09-26); https://github.com/ATTWoWAddon/AllTheThings/issues/2630 ; https://github.com/xsansebastian/FrontierScout/pull/6 ; https://github.com/jprons02/innkeepers-ledger/issues/75 | 2026-09-26 |
| **`C_EncodingUtil` is listed for Forever (patch 11.1.5+ API):** `SerializeCBOR`/`DeserializeCBOR`, `SerializeJSON`/`DeserializeJSON`, `CompressString(source, method, level)` with `Enum.CompressionMethod` 0 Deflate (raw, RFC 1951) / 1 Zlib (RFC 1950, adler32 checksum) / 2 Gzip, `Enum.CompressionLevel` incl. OptimizeForSize, `EncodeBase64`/`DecodeBase64`. Flagged `AllowedWhenUntainted`. A Forever addon already uses CBOR → Deflate → Base64 natively "without requiring a LibDeflate dependency". | https://warcraft.wiki.gg/wiki/API_C_EncodingUtil.CompressString ; https://warcraft.wiki.gg/wiki/API_C_EncodingUtil.SerializeCBOR ; https://warcraft.wiki.gg/wiki/API_C_EncodingUtil.SerializeJSON ; https://github.com/justadakaje/wow-addons/pull/2 | fetched 2026-10-04 |
| Pure-Lua alternatives LibSerialize + LibDeflate (`EncodeForPrint`) are client-agnostic and work anywhere, but have no maintained Node port of LibSerialize's wire format. We would have to write a decoder. | https://www.wowace.com/projects/libserialize | — |
| Guild roster (`C_GuildInfo.GuildRoster()` + `GetGuildRosterInfo(i)`), inspect (`NotifyInspect`, `GetInventoryItemLink`), `GetSavedInstanceInfo`, `C_ChatInfo.SendAddonMessage` | exist on retail. **No Forever-specific confirmation found → UNVERIFIED (E1/E2/E4).** | — |

**What `GetRealmName()` returns on a realmless client is UNVERIFIED.** It could be a hidden shard/realm name or the ruleset. The roster's `-<realm>` suffix suggests Forever still has internal realms under the ruleset ecosystems. Do NOT persist that suffix as the Raid Ledger realm (ROK-1718 Option B keeps `realm` NULL). Store it only as raw provenance.

## 3. Raid Ledger today (origin/main @ ad1011018)

- **Character endpoints:** `api/src/characters/characters.controller.ts:39` `@Controller('users/me/characters')`, `:64` `@Post()` (manual create), `:82` `@Post('import/wow')` (Armory import, realm-required), `:141` `@Post(':id/refresh')`. No bulk/addon import exists.
- **Character keying:** `api/src/drizzle/schema/characters.ts:52` `externalId` (the Blizzard character id for imports). The Forever identity (`ruleset` column + unique (game, region, lower(name))) is **specced, not built**: ROK-1718 Option B, built by ROK-1721.
- **Auth:** `api/src/auth/jwt.strategy.ts:31` Bearer JWT. `auth.module.ts:48` access JWT is 1h with refresh rotation (ROK-1353). Magic links put the token in the URL fragment, 15 min (`magic-link.service.ts:43,47`, ROK-1366 hardening). **There are no API keys or personal access tokens.** A desktop uploader would need a new per-user scoped token, which is new auth surface.
- **File upload precedent:** `api/src/users/users-me.controller.ts:212` `FileInterceptor('avatar', { limits: { fileSize: 5 MB } })`; `api/src/admin/branding.controller.ts` (Multer + magic-byte validation). Global JSON body limit: `api/src/main.ts:59` `2mb`.
- **Attendance:** `api/src/drizzle/schema/event-signups.ts:95` `attendance_status` + `:97` `attendance_recorded_at` (ROK-421), set via `api/src/events/events-attendance.controller.ts:108` `@Patch(':id/attendance')`. An addon encounter record could pre-fill this.
- **Guild / lockout / parse tables:** none exist (ROK-1170 / ROK-260 / ROK-255 all unbuilt).
- Latest migration on main: `0196_fk_backing_indexes.sql`. ROK-1718 already expects the next number for `ruleset`, so re-check before assigning.

## 4. Plan

### 4a. Addon v0 for the Forever beta ("RaidLedger" addon)

Lives **outside the monorepo gate**. Recommend a new folder `addon/RaidLedger/` in this repo, or a separate repo. Operator question Q1. It ships via CurseForge/Wago later. During the beta, users copy the folder into `_classic_beta_/Interface/AddOns/`.

**TOC (`RaidLedger.toc`):** (`SavedVariables` lines are kept for the local buffer only)
```
## Interface: 16001
## Title: Raid Ledger
## Notes: Snapshots your guild roster, gear, talents, lockouts and boss pulls as export strings for Raid Ledger.
## Author: <operator>
## Version: 0.1.0
## SavedVariables: RaidLedgerDB
## SavedVariablesPerCharacter: RaidLedgerCharDB
## IconTexture: <optional>
RaidLedger.lua
```
Interface 16001 is the beta number. Re-check at launch with `/dump select(4, GetBuildInfo())`. A multi-interface line (`## Interface: 16001, 11508`) lets one zip load on Classic Era too if Q4 says to support it.

**Scope v0 (all out-of-combat or event payloads):**
| Capture | API (retail-style; Forever availability per experiment) | When |
|---|---|---|
| Player identity | `UnitGUID("player")`, `GetUnitName("player", true)`, `UnitName("player")` (both returns), `UnitFullName("player")`, `GetRealmName()`, `GetCurrentRegion()`, `UnitClass`, `UnitRace`, `UnitLevel`, `UnitFactionGroup`. **Store all raw. The server decides.** | `PLAYER_LOGIN`, `PLAYER_LOGOUT` |
| Ruleset | **UNVERIFIED: no known API.** Candidates: `C_*` ruleset query, a realm-name mapping, or user choice in `/rl config`. Fallback: ask once and store in `RaidLedgerCharDB`. | first login |
| Gear | `GetInventoryItemLink("player", slot)` for slots 1–19, plus `C_Item.GetDetailedItemLevelInfo(link)` | login, `PLAYER_EQUIPMENT_CHANGED` (debounced, out of combat only) |
| Talents | `C_ClassTalents.GetActiveConfigID()` → `C_Traits.GetConfigInfo` / node ranks. Fallback: export string via `C_Traits.GenerateImportString(configID)` if present (UNVERIFIED) | login, `TRAIT_CONFIG_UPDATED` |
| Guild roster | `C_GuildInfo.GuildRoster()` → `GUILD_ROSTER_UPDATE` → loop `GetGuildRosterInfo(i)` (name, rank, rankIndex, level, class, zone, note, officernote (if permitted), online, guid). Guild name via `GetGuildInfo("player")`. | on `/rl roster` + at most every 10 min; skip in combat |
| Lockouts | `GetNumSavedInstances()` + `GetSavedInstanceInfo(i)` (name, id, reset seconds, difficulty, locked, numEncounters, encounterProgress) | login, `UPDATE_INSTANCE_INFO` |
| Boss pulls (attendance + kill/wipe) | `ENCOUNTER_START(encounterID, name, difficultyID, groupSize)` / `ENCOUNTER_END(..., success)`. Group at pull: `GetNumGroupMembers()` + `GetRaidRosterInfo(i)` / `UnitGUID("raidN")`, read *outside* the restricted path if unit names are secret in encounters (UNVERIFIED, E5). Timestamps via `GetServerTime()`. | events |
| DPS | **None in v0.** Only experiment E3 (below), which writes a probe result, not data. | — |
| Combat logging helper (optional v0.2) | Toggle `/combatlog` + Advanced Combat Logging on raid entry, like forever-logs-companion, so the file exists for phase 2. | `ZONE_CHANGED_NEW_AREA` |

**Local buffer (SavedVariables).** This is not the exfil path. It only persists snapshots between sessions so `/rl export` can include lockouts or pulls from earlier nights. `## SavedVariables: RaidLedgerDB` + `## SavedVariablesPerCharacter: RaidLedgerCharDB`. Ring buffers: last 50 pulls, one latest roster snapshot per guild. Note the beta SV *load* bug (§2.2): if it is still present, exports only cover the current session. The addon prints a warning when it detects an empty DB after a known previous export.

**Export string format (v1). OPERATOR RULING 2026-10-04.**
```
!RL1!<section>!<base64( zlib( payload ) )>
section ∈ char | guild | raid          (one string per section; `all` = not offered, keeps strings small)
payload = C_EncodingUtil.SerializeJSON(tbl)   -- default (see Q10); alt: SerializeCBOR
zlib    = C_EncodingUtil.CompressString(payload, Enum.CompressionMethod.Zlib, Enum.CompressionLevel.OptimizeForSize)
base64  = C_EncodingUtil.EncodeBase64(zlib)  -- standard alphabet (UNVERIFIED: std vs URL-safe variant; E8)
```
- **Why a plain-text header:** the server (and a human) can reject a wrong or old string before decoding. `RL1` is the envelope version, and the payload carries its own `schema` number.
- **Why Zlib, not raw Deflate:** its adler32 checksum catches a **truncated or mangled paste** (the most common failure of copy+paste exports). Node's `zlib.inflateSync` throws on a checksum mismatch.
- **Why JSON by default, not CBOR:** the server decodes with `JSON.parse` (no new npm dependency, so no `package.json` change that would push the gate to `--full`), and a support engineer can read it. After zlib the size gap with CBOR is small. CBOR (`SerializeCBOR`) would need `cbor-x` or a hand-written strict decoder. **UNVERIFIED:** how `SerializeJSON` renders sparse/integer-keyed Lua tables, so the addon must emit arrays as 1..n sequences and maps with string keys only (E8).
- **Libraries:** none bundled. LibSerialize/LibDeflate are the fallback only if E8 shows `C_EncodingUtil` missing or broken on the launch build. That costs a hand-written LibSerialize decoder on the server (Q10).
- **Common payload envelope (every section):**
```json
{ "schema": 1, "section": "char", "addonVersion": "0.1.0",
  "client": { "interface": 16001, "build": "1.60.1.70009", "locale": "enUS", "region": 1 },
  "exportedAt": 1790000000,
  "who": { "guid": "Player-1234-0ABCDEF0", "fullName": "Ana Forever",
           "raw": { "getUnitName": "Ana Forever", "unitName": ["Ana", null], "unitFullName": ["Ana", "Forever"], "realmName": "?" },
           "ruleset": "normal", "class": "PALADIN", "race": "Dwarf", "level": 60, "faction": "Alliance" },
  "data": { } }
```
- **`data` by section:**
  - `char`: `gear` (19 × `{ slot, itemId, link, ilvl }`), `talents` (`{ configId, importString?, nodes }`), `lockouts` (`[{ name, instanceId, difficultyId, resetAt, killed, total }]`), plus the optional `dps` (own per-encounter summary, only if E3 passes).
  - `guild`: `{ name, rawRealm, snapshotAt, canViewOfficerNote: false, members: [{ guid, name, rankIndex, rank, level, class, online, lastOnlineDays, note? }] }`. Officer notes are never exported (Q6). Public notes are exported only when the player ticks "include notes" in the export dialog.
  - `raid`: `{ pulls: [{ encounterId, name, difficultyId, groupSize, instanceId, startAt, endAt, success, roster: [guid, …] , rosterNames: ["First Second", …] }] }` (last 50, or "since <date>").
- **Size targets:** `char` ≈ 3–5 KB JSON → ~2 KB encoded. `guild` with 1,000 members ≈ 120 KB JSON → ~25–40 KB zlib → ~35–55 KB base64. `raid` with 50 pulls ≈ 60 KB JSON → ~15 KB encoded.
- **Edit-box / clipboard limits:** a WoW `EditBox` with `SetMaxLetters(0)` has no documented hard cap. WeakAuras routinely shows 50–300 KB export strings, but very long single-line text makes the box sluggish. The OS clipboard and a browser `<textarea>` are not a constraint at these sizes. **UNVERIFIED on Forever: experiment E7.** Export a 1,000-member `guild` string, then Ctrl+A / Ctrl+C / paste, and time it. If it is sluggish: (a) split `guild` into pages (`!RL1!guild-2of3!…`, and the server accepts them in any order and merges by `snapshotAt`), or (b) trim fields. Addon-side hard cap: refuse to show a string > 200 KB and suggest the paged export.
- **Export UI:** `/rl export char|guild|raid` opens a movable frame with a multi-line `EditBox` (read-only feel: re-sets its text on change), the text pre-selected (`HighlightText()`), the instruction "Ctrl+C, then paste into Raid Ledger → your character → Import", and the string length in KB. Never in combat (`InCombatLockdown()` → "try after combat").

**Slash commands (revised):** `/rl` (status + last snapshot times), `/rl export char|guild|raid [since <days>]`, `/rl roster` (force a roster refresh), `/rl ruleset <normal|pvp|rp|hardcore>`, `/rl probe` (E1–E8), `/rl wipe`.

**Beta experiments (the addon's real job in the beta). Each writes to `probes`:**
| # | Question | Pass = |
|---|---|---|
| E1 | `GetGuildRosterInfo` works and returns two-part names + GUIDs. What realm suffix appears? | roster rows with GUID + "First Second-…" |
| E2 | `GetInventoryItemLink` / `C_Traits` export work on the player (and on `NotifyInspect` targets out of combat) | 19 links + talent string |
| E3 | `C_DamageMeter` session totals: secret in combat? after `PLAYER_REGEN_ENABLED`? after leaving the instance? | if *not* secret after combat/outside instance → per-encounter own-DPS summary is possible in v0.3 |
| E4 | `GetSavedInstanceInfo` returns Forever raids/dungeons + reset times | lockout rows |
| E5 | `ENCOUNTER_START/END` fire with IDs. Raid unit names/GUIDs readable during/after an encounter | pull rows with roster |
| E6 | `GetRealmName()` / any ruleset API on a realmless client | a value that maps to a ruleset, or "none" |
| E7 | Edit-box + clipboard behaviour for a ~50 KB (1,000-member guild) and a ~200 KB string | copy completes in <2 s, and the pasted string decodes server-side |
| E8 | `C_EncodingUtil` present on the launch build. `SerializeJSON` output for arrays/maps. Base64 alphabet + padding. Round trip of `DecompressString(CompressString(x, Zlib))` | Node `zlib.inflateSync(Buffer.from(b64,'base64'))` + `JSON.parse` reproduces the table |

### 4b. Transport: copy+paste (RULED). Alternatives recorded.

| Option | Status | Notes |
|---|---|---|
| **A. Copy+paste export string → "Import string" on the character page** | **RULED 2026-10-04 for v0** | No file-system knowledge needed, no new auth surface (the existing session JWT), works on phone browsers too. Cost: a manual step per export, and huge guild strings may lag the edit box (E7 → paging). |
| B. SavedVariables file upload page | rejected for v0 | The user has to find `WTF/Account/<ACCT>/SavedVariables/`. Lua-source parsing risk. |
| C. Tiny desktop companion (watches SV, POSTs) | deferred, phase 3 maybe | Needs a new scoped, revocable per-user upload token (hashed at rest, `addon:upload` scope only) → security review. |
| D. ROK-815 Electron app wrapping the web UI | **superseded** | Adds nothing C lacks. Code signing and auto-update cost on two OSes. |
| E. WowUp/CurseForge apps | distribution only | They do not upload addon data to third parties. |

### 4c. Server side (phase 1): decoder, validation, binding

**Endpoint:** `POST /api/users/me/characters/:id/addon-import` with JSON body `{ importString: string, dryRun?: boolean }`. It sits under the existing `users/me/characters` controller family (`api/src/characters/characters.controller.ts:39`), authorised by the session JWT and owner-only (the character must belong to `req.user`). `dryRun` defaults to `true` and returns a preview. A second call with `dryRun:false` applies it. The global JSON limit (`api/src/main.ts:59`, 2 MB) already covers it. Add a route-level `@Body` length check.

**Decoder (pure, unit-testable, new `api/src/addon-import/addon-import.decoder.ts`, budget ≤150 counted lines):**
1. Trim whitespace/newlines (clipboards add them). Reject when the string is longer than **256 KB** (`413`).
2. Match `^!RL(\d+)!(char|guild|raid)(?:-(\d+)of(\d+))?!([A-Za-z0-9+/=]+)$` (alphabet per E8). An unknown envelope version → `422 "Update the Raid Ledger addon"` (or "update Raid Ledger" when newer).
3. `Buffer.from(b64, 'base64')`, then `zlib.inflateSync(buf, { maxOutputLength: 1_048_576 })`. This guards against zip bombs, and the adler32 check catches truncated pastes → `422 "The string looks cut off — copy it again"`.
4. `JSON.parse` with a reviver-free parse. Then reject depth > 12, arrays > 2,000 entries, strings > 2 KB (item links ≈ 100–200 B), and keys outside the schema (`.strict()`).
5. Validate with **Zod in `packages/contract`**: `AddonExportEnvelopeSchema` + a discriminated union on `section` → `AddonCharV1Schema | AddonGuildV1Schema | AddonRaidV1Schema`. `schema` must equal 1 (unknown major → 422).
6. Strip WoW escape sequences (`|c…|r`, `|H…|h`, `|T…|t`) from every display string. Item links keep only `itemId` + bonus ids parsed by regex. Never render raw strings as HTML.

**Binding to the right character (Forever identity, ROK-1718 Option B):** the import is done *from a character page*, so the target is explicit. The payload's `who` must match it:
| Check | Rule | On mismatch |
|---|---|---|
| Game | the page character's `game_id` is the Forever row (later: any WoW flavour, Q4) | 422 "This character isn't a WoW Forever character" |
| Region | `client.region` (Blizzard region id 1 US / 2 KR / 3 EU / 4 TW. UNVERIFIED on Forever) maps to `characters.region` | **reject**: region is part of the identity (ROK-1718 Q5: not editable) |
| Full name | normalise `who.fullName` (fallbacks: `raw.getUnitName`, then `unitFullName` joined with a space; strip any `-realm` suffix; NFC; case-insensitive) == `characters.name` | **reject** with "This export is for *Ana Forever*. Open that character's page or add it first", plus a deep link to Add Character prefilled (name/class/region/ruleset from the payload) |
| Ruleset | `who.ruleset` vs `characters.ruleset` | **warn, don't reject.** Ruleset is mutable (dead Hardcore characters can transfer, ROK-1718 F4). The preview offers "update ruleset to PvP?" (a checkbox, unchecked by default) |
| GUID | first import pins `who.guid` to the new `characters.addon_guid` (Q5). Later imports with a different GUID for the same name | warn: "different in-game character with the same name (deleted and recreated?)". Apply requires an explicit confirm, which re-pins |
| Class/level/race | informational | auto-update class/level when they differ (the in-game value wins over manual entry); show the diff in the preview |

**Per-section apply:**
- `char` → upsert `character_addon_snapshots` (new table: `character_id`, `section`, `schema`, `data jsonb`, `captured_at` = `exportedAt`, `imported_at`, `payload_sha256`). Ignore an older `exportedAt` than the stored one (idempotent re-paste: same sha → no-op). Lockouts fan out to ROK-260's table with `source='addon'` once it exists. Until then they live in the snapshot.
- `guild` → the exporter must be a member of that guild (their GUID appears in `members`, else 422). Upsert the ROK-1170 (adapted) `guilds` row keyed `(game_id, region, lower(name))` for Forever, with `rawRealm` kept as provenance only. Members are upserted by GUID with `source='addon_import'`, `last_seen_at = snapshotAt`, `captured_by_user_id`. Members are **never auto-claimed**: the link to an RL character only happens when that character's own owner has imported a `char` string with the same GUID. Paged strings (`-2of3`) are held in a 15-minute staging row keyed by user + `snapshotAt` until all pages arrive.
- `raid` → `addon_encounter_pulls` (dedupe on `(encounterId, startAt, exporter guild)`), matched to RL events by `game_id` + time overlap. Show the organiser a **suggested** attendance badge per signup (GUID → `addon_guid` → character → signup), and the organiser accepts it with one click into `attendance_status` (`event-signups.ts:95`). Nothing auto-writes attendance. An optional `dps` summary (E3) shows as "self-reported" on the character page only.

**Anti-tamper (the string is fully user-controlled, and base64 is not a signature):** treat everything as **self-reported**. (1) Provenance labels ("via addon · self-reported · <date>"). (2) Writes only to the importer's own character. Guild and raid data are *claims* that never change another user's character or attendance without an organiser click. (3) Corroboration: the same pull reported by 2+ distinct users → "corroborated" badge (later). (4) No HMAC in the addon: any key in Lua is public. (5) Rate limit 20 imports/h/user, plus an audit-log row (user, section, sha256, size, result). (6) Store parsed rows + sha256, **not** the raw string (Q7).

### 4d. DPS / parses (phase 2, depends on the outside world)

Order of preference:
1. **Third-party log site API.** If Warcraft Logs adds Forever, or foreverlogs.gg offers an API, re-target ROK-255 to it, keyed by region + two-part name. Zero log handling on our side. Check at launch.
2. **Report-link field on events (no API):** an organiser pastes a foreverlogs/WCL report URL on the event. A cheap addition to ROK-256.
3. **Own combat-log parser** (upload `WoWCombatLog-*.txt`, 50–500 MB per night): server-side parse of `ENCOUNTER_START/END` + damage events into per-player DPS per encounter. **L effort**, big uploads (chunked/resumable), CPU on the NAS. Not recommended unless 1 and 2 both fail.
4. If **E3 passes** (the meter is readable after combat), v0.3 of the addon records the *player's own* per-encounter damage/DPS from `C_DamageMeter` after `ENCOUNTER_END` + `PLAYER_REGEN_ENABLED`. This is self-reported and own-character-only, so it shows up as "self-reported DPS", not a parse.

### 4e. Phased stories (proposed. **Do not file until the operator rules.** Per CLAUDE.md, tech-debt is not auto-filed, and these are features.)

| Phase | Story | ACs (abridged) | Starts during beta? |
|---|---|---|---|
| 0 | **feat(addon): RaidLedger addon v0: snapshots + `/rl export` strings + beta probes** | TOC 16001 loads clean on the Forever beta with 0 Lua errors over a session. `/rl export char|guild|raid` shows a `!RL1!` string in a copyable box, and never in combat. Payload matches envelope schema v1. E1–E8 results recorded and copied into this doc. No CLEU, no secure hooks, no bundled serializer libs unless E8 fails. | **Yes. The operator develops it in the beta (agents cannot run the client).** |
| 0 | **chore(addon): golden export strings** | ≥3 real beta strings per section (anonymised: GUIDs/names rewritten *before* encoding, by the addon's own `/rl export --anon`) committed as decoder fixtures | Yes, as soon as phase 0 produces strings |
| 1 | **feat(contract+api): addon export-string decoder + `POST users/me/characters/:id/addon-import` (dry-run preview + apply for `char`)** (apply depends on ROK-1721) | Envelope regex + size cap 256 KB + `inflateSync` `maxOutputLength` 1 MB (unit: a zip bomb → 422, a truncated string → 422 "cut off"). Zod discriminated union, `.strict()`. Identity binding table (§4c) with a test per row: region/name mismatch rejects, ruleset mismatch warns, GUID pin. Re-paste is idempotent. Rate limit + audit row. Mutate every new assertion. Separate `tsc --noEmit -p api/tsconfig.json`. | Decoder + contract: **yes, against golden strings.** Apply after ROK-1721's `ruleset` schema. |
| 1 | **feat(web): "Import string" on the character page** | Button on Forever character pages (owner only) opens a `Modal` with a paste `textarea`, then a preview (diff of class/level, gear count, lockouts, warnings), then confirm. Name-mismatch error deep-links to Add Character prefilled. Both colour families, phone + desktop, fleet test plan. Reuse `docs/design-system.md` §3 primitives (Modal, Textarea/Field, Button). No new pattern expected. | after the endpoint |
| 1 | **feat(characters): addon snapshot section on the character page** | Gear/talents/lockouts render "via addon · <date>". Hidden when absent. | after import |
| 2 | **ROK-1170 (adapted) + ROK-1720**: guild model allows realm-less Forever guilds + `guild` export-string import (incl. paged strings) | `guilds` key supports `(game_id, region, lower(name))` for Forever. Roster upsert from the import is idempotent. Exporter must be in the roster. `last_seen_at` soft-removal. Source column. | design yes. Build after phase 1 |
| 2 | **ROK-260 (adapted)**: lockouts with `source='addon'` | `char` import populates lockouts. Reset expiry cron. Forever reset day configurable (UNVERIFIED actual day) | after phase 1 |
| 2 | **feat(events): `raid` export-string import → suggested attendance** | Pulls matched to events by time window. Organiser sees a "suggested: present" badge and accepts it in one click. Nothing auto-writes. | after phase 1 |
| 2 | **ROK-255/256 (re-targeted)**: parse provider + report links | Report-URL field on events (works without an API). Provider client once a Forever-capable log API exists. | report-link field: yes |
| 3 | **ROK-815 (deferred; superseded for v0 by the copy+paste ruling)**: desktop auto-uploader + scoped upload tokens, only if paste friction proves real | Per-user revocable `addon:upload` token (hashed, shown once, settings page). Tray/CLI watcher POSTs on SV change. Codex security review. | no |
| 3 | own combat-log parser | only if the 4d options 1–2 fail | no |

### 4f. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Beta API churn (names changed between 69913 and 70009) | parser/mapping breaks at launch | store raw values from several APIs. Server-side normalisation. Schema `client.build` recorded. Re-run `/rl probe` on the launch build |
| Secret values spread (roster or raid unit names secret in instances) | attendance capture fails | capture roster at `ENCOUNTER_START` only if readable, else at `PLAYER_REGEN_ENABLED` after the pull. Probe E5 |
| Ruleset not exposed to addons | can't auto-fill ruleset | user sets it once (`/rl ruleset`) or the import preview asks |
| Copy+paste friction / truncated pastes / laggy edit box for big guild strings | users give up on guild import | zlib checksum gives a clear "cut off" error. Paged guild strings. E7 measures it. Char strings are tiny |
| `C_EncodingUtil` changes or is removed on the launch build | addon export breaks | E8 at launch. Fallback LibSerialize+LibDeflate costs a server decoder port |
| Self-reported data abused (fake rosters, fake attendance) | trust | provenance labels. Own-character writes only. Organiser-confirmed attendance. Corroboration later |
| Blizzard ToS on addons that export data | low. Data-export addons (WCL's logging, GRM, Attune) are long-standing precedent | no automation in combat. No network from the addon (impossible anyway) |
| ROK-1721 slips past 2026-10-30 | phase 1 apply path blocked | parser + contract + preview can still ship against fixtures |
| Agents cannot run the WoW client | addon testing is operator-only | phase 0 is operator-driven. Agents own the server side against fixture files |

### 4g. Operator questions (each with a recommendation)

1. **Where does the addon live?** Recommend a separate public repo (`raid-ledger-addon`). It has a different release cadence and CurseForge packaging, and nothing in the monorepo CI applies to Lua. Alternative: `addon/` folder in this repo.
2. ~~Uploader choice~~ **RULED 2026-10-04: copy+paste export string → "Import string" on the character page.** Follow-up: should ROK-815 be commented and parked as "deferred by ruling" (recommend yes), or cancelled?
3. **v0 scope: roster + own gear/talents + lockouts + encounter pulls, no DPS?** Recommend **yes**, with E3 deciding whether self-reported own-DPS joins in v0.3.
4. **Also support Classic Era/Anniversary with the same addon** (multi-interface TOC; Classic still has CLEU, so DPS would work there)? Recommend **Forever only at first**, keeping the SV schema flavour-agnostic so a Classic build is cheap later.
5. **GUID storage:** a new `characters.addon_guid` column vs reusing `external_id`? Recommend a **new column**. `external_id` is reserved for the Blizzard Profile id that ROK-1722 will pin, and a GUID is a different id space.
6. **Guild roster privacy:** may one member's guild import publish the whole guild roster (with public notes) to the community? Officer notes never? Recommend: roster visible to community members only, public notes off by default, **officer notes never exported**.
7. **Keep raw import strings?** Recommend **no**: keep a sha256 + parsed rows.
8. **DPS provider:** wait for Warcraft Logs / foreverlogs.gg API (re-target ROK-255) vs build our own log parser? Recommend **wait + ship the report-link field now**. Own parser only if no provider appears within ~1 month of launch.
10. **Payload serializer: JSON (`C_EncodingUtil.SerializeJSON`) or CBOR?** Recommend **JSON**. No new npm dependency, readable in support, and the size gap is small after zlib. Switch to CBOR only if E7 shows guild strings are too big.
11. **Where does "Import string" live for the guild section: the character page (as ruled) or also the guild page later?** Recommend: the character page accepts all three sections now (the exporter's character is the anchor), and a guild page re-uses the same modal once ROK-1172 exists.
9. **File the phase-0/1 stories now?** Recommend filing the phase 0 addon story (operator-driven) + the phase 1 parser/contract story now. Hold phases 2–3.

## 5. Lane self-report

- **Ruling applied:** the operator's copy+paste export-string ruling (2026-10-04, relayed mid-spike) reshaped 0/1/4a/4b/4c/4e/4f/4g. The SV-upload and companion paths are kept only as recorded alternatives.
- **Verified:** Linear bodies of ROK-815/255/256/260/455/1170/1720/1721 (ROK-815 has no comments). Repo anchors in §3 grepped on origin/main @ ad1011018. ROK-1718 Option B approval read from its spec (§"Operator rulings").
- **Flagged UNVERIFIED:** `C_EncodingUtil` behaviour on the launch build (base64 alphabet, `SerializeJSON` array/map rendering). Edit-box performance with ~50–200 KB strings. Guild/inspect/lockout/addon-comms API availability on Forever. Whether `C_DamageMeter` values are readable after combat. Whether `GetRealmName()` or any ruleset API exists. Blizzard region ids on Forever. WCL Forever support. Forever reset days. Whether the SV-load bug is fixed (does not affect exfil).
- **Not reached:** reading the beta's own API dump (forever-addon-kit has a captured baseline; worth a dedicated grep for `GetGuildRosterInfo`/`GetSavedInstanceInfo`/`C_DamageMeter` signatures). Any primary Blizzard addon-policy document for Forever (none found).
