# ROK-1799 spike: Valheim game plugin and a WoW-style Valheim armory

**Status:** spike output. Docs only, no production code. **Base:** branch `spike/rok-1798-valheim-pelican` @ `a33726e1e` (ROK-1798 spike tip; anchors below are verified on it).
**Author lane:** spike lane, 2026-10-15. **Tier for the build:** `standard`. Slices with a migration or a new `packages/contract/**` wire format escalate as noted per slice.
**Depends on:** ROK-1798 (`docs/spikes/ROK-1798-valheim-pelican-quick-play.md`) for the console socket, the Valheim line parser and the SteamID presence tracker.

## Provenance

| Source | What it gave |
|---|---|
| Lead brief (operator ask 2026-10-15, six questions) | Scope. I had no direct access to the Linear issue body. |
| ROK-1798 spike + operator rulings | Log formats, the SteamID64 identity path, the plugin follow-on ruling. |
| Live Pelican panel, read-only (`list_servers`, `server_details`, `list_files`, `read_file` on text files only) | The operator's Valheim server: mod list, one mod config, the save directory layout, and the vanilla profile-save broadcast in the log. **No binary file was read or downloaded.** |
| Repo code (anchors below) | Plugin host, WoW and Pelican plugin structure, characters table, Steam link. |
| Web: `Kakoen/valheim-save-tools`, `lanchelms/fch-decoder`, WebMap-family mods, seed-viewer articles | Parser and renderer landscape. The `.fch` layout section is from my knowledge of the decompiled game code and is marked UNVERIFIED where it matters. |

**Privacy:** nothing below names a player, character, SteamID, world, seed or host. Server findings are described by count and size.

---

## TL;DR verdicts

| Feature | Verdict | Data path (recommended) |
|---|---|---|
| **Character ↔ RL user match** | **Feasible (vanilla)** | ROK-1798 console stream gives SteamID64 + character name; `users.steam_id` (`api/src/drizzle/schema/users.ts:17`) maps it to a user. |
| **Gear + inventory** | **Feasible-with-mod** | Character data lives only on players' PCs. Needs an exporter mod (see Q2). A server-only mod can give *visible* gear only (no quality, no inventory). |
| **Skills** | **Feasible-with-mod** | Same exporter. Not visible to the server at all in vanilla. |
| **Trophies / known items** | **Feasible-with-mod** | Same exporter (`trophies`, known recipes/materials/biomes are profile lists). |
| **Map + per-player fog + pins** | **Feasible-with-mod** (base map: feasible with a server-side render mod) | Base map rendered by the game's own world generator inside a server mod, cached per seed + game version. Fog bitmap and pins come from the player's profile via the exporter. |

**Headline finding on the operator's server:** there is **no server-side character store**. No `.fch` file exists anywhere on the volume, and none of the 13 installed BepInEx plugins is a server-character mod. The log's `Sent to <SteamID>` lines are the **vanilla save broadcast**: they follow `Sending message to save player profiles` and tell each client to save its own profile **on the client**. Every armory feature beyond identity therefore needs a mod.

**Recommendation:** one Raid Ledger–owned BepInEx mod, **"RL Valheim Link"**, shipped server + client in the group's existing modpack (the server already runs client-required mods, so players already install a pack). The client half sends a profile summary to the server on each vanilla save; the server half writes versioned JSON files into one data folder; RL reads them through the **Pelican Files API** it already talks to. No HTTP from the game to RL, no tokens on players' PCs, and the wire format is an RL-owned contract like LedgerLink.

---

## Q1: Plugin boundary

### What exists (verified anchors)

**API plugin host**
- `PluginManifest` (`api/src/plugins/plugin-host/plugin-manifest.interface.ts:15`) has `gameSlugs`, `capabilities`, `settingKeys`, `integrations` and **`dependencies?: string[]`** (`:25`).
- Dependencies are validated at install time only: `validateDependencies` (`api/src/plugins/plugin-host/plugin-registry.helpers.ts:58`). **No plugin declares one today** (grep: no `dependencies:` outside the interface and helper).
- Extension points are adapters registered by key: `EXTENSION_POINTS` (`api/src/plugins/plugin-host/extension-points.ts:252`). Relevant ones: `CharacterSyncAdapter` (`:54`, WoW-shaped: `name, realm, region`), `CharacterIdentityProvider` (`:185`), `GameServerProvider` (`:216`, registered under `GAME_SERVER_PROVIDER_KEY = '*'` `:231`).
- WoW: `WOW_COMMON_MANIFEST` id `blizzard` (`api/src/plugins/wow-common/manifest.ts:18`), registers its adapters in `registerAdapters` (`api/src/plugins/wow-common/wow-common.module.ts:242`) on init and on activation (`:137`, `:212`). WoW owns its own tables and display overrides (`resolveDisplayEquipment`, `extension-points.ts` comment at `:84`).
- Pelican: `PELICAN_MANIFEST` (`api/src/plugins/pelican/pelican.manifest.ts`), `gameSlugs: []`, capabilities `game-server-provider` + `cron-registrar`. `PelicanClient` (`api/src/plugins/pelican/pelican-client.ts:49`) has **no Files API method yet** (grep: no `files/contents`).

**Web plugin registry**
- `registerPlugin(slug, badge)` (`web/src/plugins/plugin-registry.ts:116`) returns a handle with `registerSlot`, `registerCharacterIdentity` (`:65`, impl `:129`), `registerGameServerProvider` (`:69`, impl `:139`), `registerCalendarLayer`.
- WoW registers ~20 slots, including `character-detail:sections` and `character-detail:header-badges` (`web/src/plugins/wow/register.ts`), and a character identity provider (`foreverIdentityProvider`).
- Pelican registers an admin slot, a calendar layer and the game-server provider (`web/src/plugins/pelican/register.ts`).
- Character page hosts the slots: `web/src/pages/character-detail-page.tsx:159`, `:172`, `:178`. Identity and portrait contracts: `web/src/plugins/character-identity.ts:80` (`CharacterIdentityProvider`, optional `PortraitFallback` `:101`), `web/src/plugins/character-portrait.tsx:29`.

**Characters table**
- `characters` (`api/src/drizzle/schema/characters.ts:23`): `name`, `realm`, `externalId` (`:52`), `equipment`/`talents`/`professions` jsonb (`:82-86`, WoW-shaped DTOs), unique on `(user_id, game_id, name, realm)` (`:94`).

### Proposed split

| Owner | Owns | Why |
|---|---|---|
| **Pelican plugin** (`pelican`) | The panel connection: client-API key, the console **websocket** (ROK-1798 slice 2), the supervisor per server, and a new **Files API** client (`listFiles`, `readFile`, `downloadFile`). Exposes raw console lines and file reads **per server, tagged with the server's `game_id`**. No game knowledge. | It is a hosting-panel plugin; the next game (Core Keeper, Palworld) reuses it unchanged. |
| **Valheim plugin** (`valheim`, new, `gameSlugs: ['valheim']`, `dependencies: ['pelican']`) | The ROK-1798 **line parser**, the SteamID↔character pairing, the **armory store** (plugin tables), the exporter-JSON reader and its contract, the map tiles, and the web armory sections. | Mirrors WoW: game logic and game tables live in the game plugin. |
| **Core** (`discord-bot/services` ad-hoc path) | The game-agnostic **presence tracker → Quick Play bridge** (ROK-1798 slices 4–5). Takes typed `join(steamId, label)` / `leave(steamId)` events. | Quick Play is core; it must not import a game plugin. |

**How Valheim talks to Pelican (new extension points, both in `extension-points.ts`):**
1. `GAME_LOG_PARSER` keyed by game slug. Valheim registers `{ gameSlugs: ['valheim'], parse(line): PresenceEvent | ArmoryTrigger | null }`. The Pelican supervisor looks up the parser by the server's game slug and pipes lines to it; parsed presence events go to the core tracker. **Pelican never imports Valheim.**
2. `GAME_SERVER_FILES` (`'*'` key, like `GameServerProvider`). Pelican implements `listFiles(serverRef, dir)` / `readFile(serverRef, path)`. Valheim resolves it to pull exporter JSON. **Valheim never imports Pelican.**

Install-time `dependencies: ['pelican']` gives a clear admin error; at runtime each side checks the adapter is present (the plugin may be inactive), as `CharacterIdentityProvider.pluginSlug` already does.

**Change to ROK-1798's slicing:** its slice 1 parser moves from `api/src/plugins/pelican/presence/*` to `api/src/plugins/valheim/`; its tracker moves to core. Slice 2 (socket) stays in Pelican.

**Do not reuse** `CharacterSyncAdapter` or `characters.equipment`: both are WoW-shaped. Valheim gets plugin tables and its own `character-detail:sections` component.

---

## Q2: Where character data lives (operator's server, read-only check)

### Findings (generic, no names)
- **Server-side character mod:** none. Installed plugins (13): AdvancedPortals, ConditionalConfigSync, DiscordScreenshots, **EquipmentAndQuickSlots 3.1.3**, Jotunn, JsonDotNET, MultiUserChest, NetworkPerformanceSystem, QuickStackStore, Seasonality, ValheimVoiceChat (proximity voice), XPortal, YamlDotNet. No ServerCharacters-style mod.
- **`.fch` files:** **0** on the volume. Only the dedicated server's standard tree under `.config/unity3d/IronGate/Valheim/` (`worlds_local/`, `adminlist.txt`, `bannedlist.txt`, `permittedlist.txt`, `prefs`). No `characters/` or `characters_local/`.
- **World saves:** the live world is a **chunked layout**, not the classic `<world>.db` + `<world>.fwl`: one `_main.<n>.db2` (~150 KB), one `_main.<n>.fwl2` (~2.5 KB), a `.chunks` index, a `.ok` marker and **16 `*.chunk` files** (from ~1 KB to ~1.5 MB). The log confirms it (`GetSaveClonePerChunk. Calculated number of actual chunk files: 16`). Plus several auto-backup and wiped-world folders.
  - **This is a newer save format than any open-source parser I found documents. UNVERIFIED:** whether Kakoen's tool reads it. Assume it does not.
- **The `Sent to` lines:** each follows a vanilla `Sending message to save player profiles` line at the save interval (`-saveinterval 1800`, i.e. every 30 min). They are the server telling each client to save locally. **Profiles never reach the server.**
- **EquipmentAndQuickSlots matters for parsing:** it adds dedicated equipment and quick-slot positions to the player inventory and, with `Slots backup enabled = true`, writes a backup of those slots into the character save. A raw `.fch` parser must tolerate extra grid rows and mod custom data; an in-game exporter reads the slots through the mod's inventory API instead.

### Options compared

| Option | Gear/inv | Skills | Trophies | Fog + pins | Player effort | RL cost | Risk |
|---|---|---|---|---|---|---|---|
| **A. RL Valheim Link mod (client + server), JSON contract** (recommended) | yes, incl. EAQS slots | yes | yes | yes | Mod is in the pack; nothing else | JSON reader + contract | Mod to maintain across game updates (reflection-light: uses public game objects) |
| **B. Server-character mod** (e.g. ServerCharacters) + RL parses `.fch` from the server | yes | yes | yes | yes, if the mod keeps map data (UNVERIFIED) | Mod in pack | **Binary `.fch` parser in TS**, with version drift | Intrusive: the server becomes the character authority (characters locked to the server); compatibility with EAQS untested; RL needs `file.read` on binary files |
| **C. Player uploads `.fch`** on the web | yes | yes | yes | yes | Manual, every time | Binary parser in TS | Stale; players will not do it; drift as in B |
| **D. Server-only mod** (no client install) | **visible gear only** (ZDO visual-equipment hashes: weapon, shield, helmet, chest, legs, shoulder, utility; no quality/durability) | no | no | **server-observed** fog only (positions the server saw, explore radius approximated); **no pins** | none | small | Partial armory |

**Recommended default: A**, with **D's map render** folded into its server half. B and C both force RL to own a binary parser for a format that changes on game updates; A moves that cost into game code that reads the game's own objects.

**Exporter contract** (mirrors LedgerLink, `packages/contract/ledgerlink/v1/` with `CONTRACT.md`, `schema.json`, `fixtures/`, `CHANGELOG.md`):
- New `packages/contract/valheim-link/v1/` + Zod source of truth `packages/contract/src/valheim-link-*.schema.ts`.
- One file per character: `<data dir>/characters/<playerId>.json` = `{ v: 1, steamId, playerId, name, savedAt, gameVersion, equipment[], inventory[], skills[], trophies[], knownBiomes[], stats{}, worlds: [{ worldUid, explored: base64(gzip(bitset 2048×2048)), exploredShared?: …, pins: [{ name, x, z, type, checked }] }] }`.
- One world file: `<data dir>/world/<worldUid>-<gameVersion>.png` + `meta.json { textureSize, pixelSize, worldRadius }`.
- Same rules as LedgerLink: only an RL PR changes the format; additive vs breaking per CLAUDE.md.

**RL permission impact:** the RL subuser (ROK-1798 ruling 9: `websocket.connect` only) would also need **`file.read` + `file.read-content`**. Pelican file permissions are **server-wide, not path-scoped**, so RL could read every config on the volume, including files with the server password. Secret-masking happens in skeleton-key, not in RL. See operator question 3.

---

## Q3: The `.fch` format (reference for options B/C; UNVERIFIED against the current game build)

From the decompiled `PlayerProfile.SavePlayerToDisk` / `Player.Save` / `Inventory.Save` / `Skills.Save` / `Minimap.GetMapData` (assembly_valheim). Field order is append-only and version-gated; treat this as orientation, not a spec.

- **Envelope:** little-endian. `int32 length` + payload + `int32 hashLength` + SHA-512 of the payload. Strings are .NET `BinaryWriter` strings (7-bit length prefix + UTF-8).
- **Profile:** `int32 profileVersion`; stats (older: kills/deaths/crafts/builds; newer: a `PlayerStatType → float` dictionary); then **per-world records**: `int64 worldUid`, custom spawn / logout / death points (bool + Vector3 each), home point, and **`byte[] mapData`**; then `playerName`, `int64 playerId`, `startSeed`; then **`byte[] playerData`**.
- **`playerData`:** version, health/stamina, guardian power + cooldown, **inventory** (version, count, per item: prefab name, stack, durability, grid pos, **equipped flag**, quality, variant, crafter id + name, custom data dict, world level, picked-up), known recipes, known stations, known materials, tutorials, uniques, **trophies (list of prefab names)**, **known biomes**, known texts, appearance, foods, **skills** (version, count, per skill: `int type`, `float level`, `float accumulator`), custom data.
  - **Equipment** = inventory items with `equipped = true` (plus EAQS slot rows on this server).
- **`mapData`:** version, `int textureSize` (2048), **explored** as a `bool` per pixel (2048×2048 = 4 MiB raw), then **pins** (name, Vector3 position, pin type, checked flag, owner id / author), a public-position flag, and in newer versions a second **shared-explored** layer (from cartography tables). Newer versions **gzip** the map blob.
- **Size:** dominated by map data; a few hundred KB to a few MB per profile, depending on exploration and number of worlds.
- **Version drift:** profile and inventory versions bump on most content updates; the server here already shows a save format newer than the parsers document.

**Open-source parsers**

| Project | Language | Licence | Scope | Maintenance |
|---|---|---|---|---|
| [Kakoen/valheim-save-tools](https://github.com/Kakoen/valheim-save-tools) | Java 17 | **none stated** (cannot vendor) | `.fch`, `.db`, `.fwl` ↔ JSON; `--failOnUnsupportedVersion` | ~141 commits; no recent date shown |
| [lanchelms/fch-decoder](https://pkg.go.dev/github.com/lanchelms/fch-decoder) | Go | MIT | `.fch` → JSON, editor, Prometheus exporter (skills, stats, worlds) | v1.6.0 published Jul 2026, newer exists |
| Loki character editor | C# (.NET Core 3.1) | open source, pre-release | appearance, skills, inventory | stale |

None is in TypeScript. Option B/C would mean porting one (MIT Go is the only clean licence) and chasing versions. **Another reason to prefer A.**

---

## Q4: Map rendering

- **No open-source port of the Valheim world generator** turned up (TS, Rust or C#). Seed viewers such as valheim-map.world are closed source ([MeinMMO](https://mein-mmo.de/en/the-best-seeds-for-valheim-and-what-you-find-on-the-maps,649130), [Inverse interview](https://inverse.com/gaming/valheim-map-seed-viewer-world-generator-interview)).
- **What works and stays correct across updates:** ask the **game's own `WorldGenerator`** for biome and height on a grid, inside a server mod. That is how server web-map mods do it: [ValheimWebMap on Thunderstore](https://thunderstore.io/c/valheim/p/koenhendriks/ValheimWebMap/) caches the full-resolution render on disk and re-renders after a game update; [ValheimOne](https://www.nexusmods.com/valheim/mods/3571) (MIT, `github.com/HumanGenome/ValheimOne`) draws a live map from the server seed; [Supercraft](https://supercraft.host/article/valheim-seed-viewer/) describes the same approach at a 24 m grid.
- **Recommended:** the server half of RL Valheim Link renders **once per (world uid, game version)** to a **2048×2048 PNG** matching the minimap grid, writes it to its data dir, and RL copies it into its own storage. Render time is UNVERIFIED (expect tens of seconds to minutes on a 2-core limit; do it off the main thread at world load or on an admin trigger). The seed never leaves the server.
- **Alignment (UNVERIFIED constants, from `Minimap`):** `textureSize = 2048`, `pixelSize = 12 m`, so the map spans 24,576 m with world origin at the centre. `px = x / 12 + 1024`, `py = z / 12 + 1024`; image row = `2047 - py`. The exporter's `meta.json` carries the constants so RL never hardcodes them.
- **Fog:** the client composites the base PNG with a canvas mask built from the explored bitset (alpha 0 where explored). Optional second layer for shared (cartography) exploration.
- **Pins:** an SVG overlay, same transform, icon by pin type. Death pins and the bed/spawn can be toggled.
- **Zoom:** 2048² is fine for a single image with CSS zoom. Tiling (Leaflet-style) is a later nicety, not v1.

---

## Q5: Identity

- **Column:** `users.steam_id`, unique and nullable, set by Steam OpenID link (`api/src/drizzle/schema/users.ts:17`; link callback `api/src/steam/steam-auth.controller.ts:193`, verified id `:233`).
- **Automatic match:** exporter JSON (and the ROK-1798 console) carry `steamId` + `playerId` + `name`. `steamId → users.id`. On a match, upsert a `characters` row: `userId`, Valheim `gameId`, `name`, `externalId = 'valheim:<playerId>'` (`characters.ts:52`), `realm = null`. One Steam account can own several Valheim characters: key on `playerId`, not name.
- **No match:** keep it in a plugin table `valheim_profiles (player_id PK, steam_id, name, user_id NULL, character_id NULL, payload jsonb, saved_at)`. When that Steam account is linked later, a listener attaches the rows automatically.
- **Claim fallback:** WoW lets a player claim by name. For Valheim, **a name claim is spoofable** (names are free text and can collide). Recommended: the only claim path is **"Link Steam to claim"** (the existing OpenID flow); admins may assign manually. A web `CharacterIdentityProvider` for Valheim supplies the realm-less label and portrait fallback.
- **Crossplay players** (Xbox / Game Pass) have no SteamID: anonymous only, as ROK-1798 ruled for v1.

---

## Q6: Freshness, cost, privacy

- **When data changes:** the client writes its profile at every vanilla save broadcast (every `-saveinterval`, 30 min here), on logout and on quit. RL Valheim Link sends its summary on the same hooks.
- **Trigger, do not poll blind:** the Valheim parser emits an `ArmoryTrigger` on `Sending message to save player profiles` and on a ROK-1798 disconnect. RL then lists the data dir, compares `modified` times, and reads only changed files after a short delay (default 10 s). A **daily cron** backstops a missed trigger. No console socket means no trigger; the cron still catches up.
- **Cost:** one `list` plus N small reads per save tick, where N is the number of players online. JSON is a few KB plus the map blob (gzip bitset, typically tens to a few hundred KB, UNVERIFIED). Store the payload in `valheim_profiles` and the explored blob in `bytea` per `(player_id, world_uid)`; keep the latest only (no history in v1). The base map PNG is a few MB per world/version.
- **Privacy defaults (recommended):**
  - Character sheet (equipment, skills, trophies, level-ish stats): visible to signed-in members, like WoW characters.
  - **Inventory, map, fog and pins: owner + admins only**, with an owner toggle to share with members. Pins reveal base and portal locations.
  - Unlinked players: no armory page; admins see a list of unclaimed profiles.
  - The seed never leaves the server; only the rendered PNG does.
  - Never log raw exporter JSON (pins carry free text).

---

## Sliced build plan (each slice is one ~25-turn lane)

| # | Slice | Depends on | Files | Test tier | Gate |
|---|---|---|---|---|---|
| V0 | **Valheim plugin shell.** `api/src/plugins/valheim/` (manifest `valheim`, `gameSlugs: ['valheim']`, `dependencies: ['pelican']`, module), `web/src/plugins/valheim/register.ts` (badge only). Two new extension-point types: `GAME_LOG_PARSER`, `GAME_SERVER_FILES`. | none | new | unit | `--static` |
| V1 | **Move ROK-1798's parser into Valheim** and register it as `GAME_LOG_PARSER`; add the `ArmoryTrigger` line (`Sending message to save player profiles`). Core tracker consumes typed events. | ROK-1798 slices 1–2, V0 | valheim + pelican supervisor | unit | `--static` |
| V2 | **Pelican Files API client** + `GAME_SERVER_FILES` implementation (`listFiles`, `readFile` with size cap, JSON only). | V0; operator Q3 | pelican | unit + integration (fake panel) | `--static` |
| V3 | **Contract** `packages/contract/valheim-link/v1/` (Zod, generated `schema.json`, anonymised fixtures, `CHANGELOG.md`, drift-guard test). | none | contract | unit | `--static` (additive, new schema) + contract spec on the fleet |
| V4 | **RL Valheim Link mod** (C#, BepInEx, separate repo like LedgerLink). Client: summary RPC on save/logout. Server: write JSON + render map PNG + meta. | V3 | new repo | in-game manual + fixture output | its own CI |
| V5 | **Armory store + importer.** `valheim_profiles` + map blob table (migration last), trigger + daily cron, SteamID auto-match, auto-attach on Steam link. | V1, V2, V3 | valheim + migration | integration | **`--full`** (migration) |
| V6 | **Character page sections:** equipment, inventory grid (EAQS-aware), skills, trophies. Item icons: UNVERIFIED source (see Q4 operator question). Reuses design-system primitives; fleet test plan. | V5 | web valheim | Playwright + test plan | `--static` + changed specs |
| V7 | **Map tab:** base PNG + fog canvas + pin overlay, owner/admin visibility + share toggle. | V5, V4 map render | web + api endpoint | Playwright + test plan | `--static` + changed specs |

Parallel: V0, V3 and ROK-1798 slices 1–3 can run together; V4 runs in the mod repo once V3 is frozen. V5 needs V1+V2+V3; V6/V7 need V5.

---

## Operator rulings (2026-10-15)

- **Q1 data source: option A.** The RL Valheim Link mod ships in the operator's **GamerSaloon Valheim modpack** (`github.com/sjdodge123/GamerSaloon-Valheim-Modpack`), so every client gets it.
- **Q2 repo:** the mod lives under the operator's GitHub org **`Raid-Ledger-Plugins`** (which already hosts `coworker-bot`), not under `sjdodge123/`. Its wire contract still lives in Raid Ledger (`packages/contract/valheim-link/v1/`), per the LedgerLink rule.
- **Q4 item names/icons:** the operator points at **https://www.valheim.tools/items** as a source. Use it as a reference for item ids, names and categories, and for link-outs. Before copying icons or bulk data from it, check its terms. The game's own ObjectDB export from the mod (the default) stays the source for icons we host, because it matches the installed game version and the modded items.
- Q3 and Q5–Q9: not yet ruled; the defaults below stand until the operator says otherwise.

## Operator questions (recommended default in bold)

1. **Data source:** build our own client+server mod and add it to the modpack (A), adopt a server-character mod (B), or accept web uploads (C)? **Default: A.**
2. **Mod home:** a separate repo like LedgerLink (`ledger-link`), with the wire format owned here? **Default: yes, new repo; contract in `packages/contract/valheim-link/v1/`.**
3. **Pelican permissions:** grant the RL subuser `file.read` + `file.read-content` (server-wide; it could read configs that hold the server password)? **Default: yes, but RL code only reads under the mod's data dir (allow-list enforced in `GAME_SERVER_FILES`).**
4. **Item icons and names:** Valheim prefab names (`SwordIron`) need display names and icons; no official API. Extract from the game in the mod (export once per version) or a community wiki? **Default: the mod exports names + icon atlas once per game version.**
5. **Who sees what:** sheet to members; inventory + map + pins owner and admins only, owner can share. **Default: as stated.**
6. **Claim:** Steam-link only, no name claims; admins can assign manually. **Default: yes.**
7. **Map exploration layers:** show personal fog only, or also the shared cartography-table layer? **Default: personal, with shared as a toggle.**
8. **History:** keep only the latest snapshot per character (no timeline). **Default: latest only in v1.**
9. **Unlinked players:** list them for admins only, no public page. **Default: yes.**

---

## What I verified, flagged, and did not reach

- **Verified:** every repo anchor above by grep on `a33726e1e`; the server's mod list, absence of `.fch` and of any character mod, the chunked world layout (counts and sizes), the vanilla save broadcast, and the EAQS config (equipment + quick slots, slot backup into the save).
- **Flagged UNVERIFIED:** the `.fch` field order and map constants for the current build; whether any parser reads the chunked world format; map render time; ServerCharacters keeping map data; the map blob size.
- **Not reached:** a real `.fch` sample (binary reads were out of scope); the RL file-storage location for the base map PNG (DB `bytea` vs a volume path) — the V5/V7 lane should check how RL stores uploaded images today. The `valheim` slug exists in the seed games list (`api/src/games-lookup/seed-games.data.ts:182`).
