# ROK-1951 spike: Raid Ledger Companion (generic desktop collectors, BG3 first)

Status: research spike, documentation only. Written 2026-10-24.
Story: ROK-1951. Related: ROK-1942 (Gallery), ROK-1909 / ROK-1918 (hub widgets), ROK-1829 / ROK-1833 (ValheimLink contract + ingest), LedgerLink v1, ROK-815 (old Electron WoW-sync spike, superseded 2026-10-04).

**Confidence tags used below:**
- **VERIFIED (save):** read from the operator's real save `QuickSave_179.lsv` (23 MB, Patch 8 build `4.1.1.7631656`, Steam, a 4-player Act 2 party). It was parsed locally in an isolated scratch directory and never uploaded. Character and player values are redacted as `<name>`.
- **VERIFIED (repo):** read in this checkout.
- **SOURCED:** stated by a public source linked inline.
- **UNVERIFIED:** inferred or recalled.

---

## 1. Summary and recommendation

1. **BG3 v1 needs no mods, no LSLib and no .NET.** The real save confirms this.
   - The `.lsv` is an LSPK v18 package of 11 files, each Zstd-compressed, with an LZ4-compressed file table.
   - It contains `SaveInfo.json`, which is plain JSON: every party member's race, class/subclass (multiclass is a list), level, XP and origin, plus the current level id, difficulty, ruleset, game version and platform.
   - It also contains the thumbnail, a 1280×720 WebP.
   - The format took about 60 lines of standard-library Python to read (the zstd module that ships with Python 3.14, plus a 20-line LZ4 block decoder).
   - **What `SaveInfo.json` does not carry:** character names, player/Steam ids and the save time. Those live in the binary LSF files (`meta.lsf`, `Globals.lsf`, LSF v7), which every public tool reads through LSLib. The tools say that data drifts between patches. **Defer it**, or port a small LSF reader for `meta.lsf` only (§9 Q7).
2. **Steam covers achievements and playtime server-side, with no desktop app.** `users.steam_id` exists, and Raid Ledger already calls `GetOwnedGames`. Adding `GetPlayerAchievements` for app 1086940 gives a per-member achievements widget. **Ship it first.**
3. **Companion architecture.** One tray app runs per-game **collectors**, each declared by a manifest: the watched paths per OS, a built-in parse step, the Raid Ledger-owned contract id + version, the upload cadence and the privacy fields.
   - The app authenticates with a **per-user device token** obtained through a device-link flow, reusing the ValheimLink token helpers.
   - All collectors post to **one ingest endpoint** that routes by contract.
   - Uploads wait in an offline queue where latest wins.
   - Every collector is opt-in per game, with a local preview before upload.
4. **Tech: Tauri v2.**
   - The binary is 2–10 MB.
   - Signed updates are mandatory.
   - Its fs plugin supports `watch` with scoped permissions.
   - The UI is the team's React/TS stack.
   - The BG3 parser is Rust, and the same code compiles to WASM, so a web **drag-and-drop `.lsv` upload** can ship before the desktop app does (§9 Q2).
5. **WoW collector.** It reads LedgerLink's SavedVariables and posts the export string it finds to the **existing** addon-import decoder, so the LedgerLink v1 format does not change. It needs an operator ruling, because it revisits the 2026-10-04 "paste only" ruling (§9 Q1).

---

## 2. BG3 data available

BG3 Steam app id: **1086940**.

### 2.1 Save file (Q1)

**Location**
- **Windows:** `%LOCALAPPDATA%\Larian Studios\Baldur's Gate 3\PlayerProfiles\Public\Savegames\Story\<save folder>\<name>.lsv`. SOURCED: [bg3-save-tools](https://github.com/CharlesMcquade/bg3-save-tools), [gamepretty](https://gamepretty.com/baldurs-gate-3-save-file-location-how-to-save/).
- One Steam thread points under Documents instead, so the collector probes both. SOURCED: [Steam discussion](https://steamcommunity.com/app/1086940/discussions/0/3812913197990431217).
- **macOS:** `~/Documents/Larian Studios/Baldur's Gate 3/…/Savegames/Story/`. UNVERIFIED.
- **Steam Deck / Proton:** `…/steamapps/compatdata/1086940/pfx/drive_c/users/steamuser/AppData/Local/Larian Studios/…`. UNVERIFIED.

**Package (LSPK), VERIFIED (save)**

| Offset | Field | Value in the sample |
|---|---|---|
| 0 | magic | `LSPK` (`0x4B50534C` LE) |
| 4 | version u32 | **18** |
| 8 | FileListOffset u64 | near the end of the file (the table is stored last) |
| 16 | FileListSize u32 | 338 |
| 20 | Flags u8 / Priority u8 | 0 / 0 |
| 22 | MD5 [16] | package checksum |
| 38 | NumParts u16 | 1 |

- **File table:** at FileListOffset sit `NumFiles u32`, `CompressedSize u32`, then an **LZ4 block** that decompresses to `NumFiles × 272` bytes of `FileEntry18` records: `Name[256], OffsetInFile1 u32, OffsetInFile2 u16, ArchivePart u8, Flags u8, SizeOnDisk u32, UncompressedSize u32`. The layout matches LSLib's [PackageFormat.cs](https://github.com/Norbyte/lslib/blob/master/LSLib/LS/PackageFormat.cs).
- **Compression:** every entry has `Flags = 0x23`. The low nibble `3` means **Zstd**; `0x20` is a compression-level bit. Method values 0 = none, 1 = zlib, 2 = LZ4 and 3 = zstd are consistent with the sample: the table decoded as LZ4 and every entry as zstd.

**Contents of the sample (uncompressed sizes):**

| File | Size | What it is |
|---|---|---|
| `SaveInfo.json` | 2.6 KB | **JSON**, readable directly (below) |
| `<SaveName>.WebP` | 41 KB | **Thumbnail inside the package**: WebP (VP8), **1280×720** |
| `meta.lsf` | 1.7 KB | LSF v7: save metadata (below) |
| `Globals.lsf` | 3.9 MB | LSF v7: global world/ECS state |
| `StorySave.bin` | 48 MB | Osiris story database (header `\0Osiris `) |
| `LevelCache/*.lsf` (6 files) | 0.02–13.7 MB | Per-level caches (`WLD_Main_A`, `SCL_Main_A`, `CRE_Main_A`, camp, CC, Astral Plane) |

**`SaveInfo.json`: exact structure, VERIFIED (save)** (UTF-8 with BOM; values shown only where non-personal)

```jsonc
{
  "Active Party": {
    "Characters": [                       // 5 in the sample: 4 player characters + 1 summon
      {
        "Classes": [                      // ABSENT for summons; >1 entry = multiclass
          { "Main": "Ranger", "Sub": "GloomStalker" },
          { "Main": "Rogue",  "Sub": "Thief" }
        ],
        "Experience Points (Current level)": 5630,   // int
        "Experience Points (Total)": 35630,          // int
        "Level": 8,                                   // int
        "Origin": "Generic",       // "Generic" = custom Tav; origin companions use their own id; summons e.g. "DogFamiliar_Scratch_Summon"
        "Position": [x, y, z],     // floats, world coordinates
        "Race": "Duergar",         // engine ids: "Elf_WoodElf", "Human", "Tiefling_Asmodeus", "Beast"
        "Subregion": ""            // empty string in every sample entry
      }
    ]
  },
  "Current Level": "SCL_Main_A",   // engine level id (SCL = Shadow-Cursed Lands, Act 2), NOT a display name
  "Difficulty": ["DifficultyHard", "RulesetLarian"],   // [difficulty, ruleset]
  "Game Version": "4.1.1.7631656",
  "Platform": "Steam",
  "Save Name": "QuickSave_179"
}
```

- **Not in `SaveInfo.json` (VERIFIED absent):**
  - **Character names**: there is no name field at all.
  - **Player identity** (Steam id, profile, which human controls whom).
  - **Save timestamp** and **playtime**.
  - **Campaign / session id**.
  - **A friendly region name.**
- **Implications for the design:**
  - "Where we are" needs a small **level-id → act/region display table** (`SCL_Main_A` → "Act 2 · Shadow-Cursed Lands", `WLD_Main_A` → "Act 1 · Wilderness" and so on). We maintain it; it is cheap.
  - The save time comes from the file mtime.
  - Party members show as race + class + level unless we read names from LSF (§9 Q7).

**`meta.lsf`, VERIFIED (save) for the format; values UNVERIFIED**
- LSF v7 (`LSOF` magic, version 7, engine version 4.8.0.700).
- Attribute names readable in the uncompressed string table: `GameID`, `SaveTime`, `CurrentSubRegion`, `LevelUniqueKey`, `HasUnofficialMods`, `OriginalPlatform`, `Crossplay`, `TutorialFinished`, `HonorDifficultySelected` (fragmented), `CustomRulesetValues`, `ModuleSettings` (mods), `Sanity`, plus build strings `4.1.1.7209685` / `4.1.1.7631656` (the original and current builds).
- **`GameID` is the natural campaign key, and `SaveTime` the real save time.** Reading their values needs an LSF v7 node/attribute decoder. The node and value sections are compressed, so this is not plain text. See [bg3-save-skill](https://github.com/hylqs97/bg3-save-skill) on `MetaData/Sanity`.

**`Globals.lsf`, VERIFIED (save) for size and format**
- 3.9 MB uncompressed (1.7 MB zstd in the package), LSF v7 with the same header as `meta.lsf`.
- **Not readable without an LSF decoder.** Every public tool converts it with LSLib: `Divine.exe -g bg3 -a convert-resource -i lsf -o lsj`. SOURCED: [bg3-save-tools](https://github.com/CharlesMcquade/bg3-save-tools).
- **Contents (SOURCED):**
  - Quest `Journal` with `QuestVisitedSteps`, and `DialogLogs` ([bg3-save-tools](https://github.com/CharlesMcquade/bg3-save-tools)).
  - Approval via `DB_ApprovalRating` ([bg3-save-skill](https://github.com/hylqs97/bg3-save-skill)).
  - Gold/inventory: "UNSUPPORTED … modern components may be opaque" (bg3-save-skill).
  - Ability scores, feats and gear sit in the ECS "NewAge" blob, which LSLib "can extract … but can't interpret", with "Expect field layouts to drift between patches" ([bg3-newage](https://github.com/marius851000/bg3-newage), [BG3-ImHex-Patterns](https://github.com/LennardF1989/BG3-ImHex-Patterns)).
- **Patch fragility: high.** Those tools pin to 4.1.1 / Osiris 1.15.

**Tooling**
- **Norbyte LSLib:** MIT licence, **.NET 8**, latest v1.20.4. Its build is Windows-oriented, it has one Linux fix, and macOS is not mentioned. Zstd support arrived in 1.19.4. SOURCED: [LSLib](https://github.com/Norbyte/lslib), [releases](https://github.com/Norbyte/lslib/releases).
- **Non-.NET:**
  - [`bg3rustpaklib`](https://docs.rs/bg3rustpaklib) v0.1.5 (MIT) reads LSPK v15/16/18 with LZ4 and Zstd. It does not parse LSF.
  - [`zstd-rs`](https://docs.rs/zstd-rs) is pure Rust and builds for WASM.
  - The LSPK layer is small enough to write ourselves; the sample needed ~60 lines.
  - No non-.NET LSF reader exists. LSF v7 (header, string table, node/attribute/value tables) would be a port from LSLib's `LSFReader`, roughly 300 lines. That is worth it only for `meta.lsf` (`GameID`, `SaveTime`); `Globals.lsf` stays deferred.

### 2.2 Steam Web API (Q2)

- **Already used** (VERIFIED, repo `api/src/steam/steam-http.util.ts`): `ISteamUser/GetPlayerSummaries/v2`, `IPlayerService/GetOwnedGames/v1` (which returns `playtime_forever`) and `IWishlistService/GetWishlist/v1`. `users.steam_id` is linked via OpenID (ROK-417).
- **Add:**
  - `ISteamUserStats/GetPlayerAchievements/v1` (`key`, `steamid`, `appid`, `l`).
  - `GetSchemaForGame/v2` (`key`, `appid`) for names and icons.
  - `GetGlobalAchievementPercentagesForApp/v2` (`gameid`, no key) for rarity.
  - SOURCED: [Steamworks ISteamUserStats](https://partner.steamgames.com/doc/webapi/ISteamUserStats).
  - Optional: `IPlayerService/GetRecentlyPlayedGames`.
- **Privacy:** owned and recent games return data only "if the profile is publicly visible", unless the key's own account is asking. SOURCED: [steam wrapper docs](https://github.com/AndreVarandas/steam), [Valve wiki](https://developer.valvesoftware.com/wiki/Steam_Web_API). Achievements need **Game details: Public**. UNVERIFIED wording; private returns an error or empty result. The widget shows "Steam game details are private", never zero.
- **Confidence:** high for public profiles. A daily refresh per linked member is far below Valve's daily cap (recalled 100k/day, https://steamcommunity.com/dev/apiterms).

### 2.3 Discord (Q2)

Presence ("playing Baldur's Gate 3") and voice are already ingested. Together they give "who is playing now" and session length. Rich-presence detail (act/region) is UNVERIFIED; assume game name only.

### 2.4 What each source can feed

| Hub datum | Source | Confidence |
|---|---|---|
| Party: race, class/subclass (multiclass), level, XP, origin, summons | `SaveInfo.json` | **VERIFIED** |
| Act / area | `SaveInfo."Current Level"` + our id→name table | **VERIFIED** (table is ours) |
| Difficulty + ruleset, game version, platform | `SaveInfo.json` | **VERIFIED** |
| Save screenshot | `<SaveName>.WebP` inside the `.lsv` (1280×720) | **VERIFIED** |
| Last-save time | file mtime (now); `meta.lsf SaveTime` (needs LSF) | high / VERIFIED key exists |
| Campaign key (group saves into one playthrough) | `meta.lsf GameID` (needs LSF); fallback save-folder name | VERIFIED key exists |
| Character names | not in `SaveInfo`; LSF (`Globals`/`meta`), UNVERIFIED where | low |
| Which RL member plays which character | not in `SaveInfo`; manual claim | VERIFIED absent |
| Session history | one upload per save → timeline | derived, high |
| Achievements + rarity, playtime | Steam Web API | high (public profiles) |
| Who's playing now, session length | Discord presence/voice | high |
| Gold, inventory, gear, ability scores, approval, quests | `Globals.lsf` (LSLib today) | low; patch-fragile; defer |

---

## 3. Companion architecture (Q3)

### 3.1 What exists to reuse (VERIFIED, repo)

- **ValheimLink**
  - Contract docs: `packages/contract/valheim-link/v1/` (`CONTRACT.md`, generated `schema.json`, `fixtures/`, `CHANGELOG.md`). Zod in `packages/contract/src/valheim-link-*.schema.ts`.
  - Ingest: `POST /plugins/valheim/link/messages/:kind` (`api/src/plugins/valheim/link/ingest/valheim-link-ingest.controller.ts`). A bearer guard and a rate-limit guard run before a bounded body read at a per-kind cap (`valheim-link-body.reader.ts`, which bypasses the global JSON parser). It returns 202 `accepted|stale`.
  - Latest `capturedAt` wins per snapshot key. A `capturedAt` more than 5 min in the future is rejected.
  - Binaries are uploaded separately by sha256 (`link/blobs/`), with hash, length and IHDR checks before decode.
  - Tokens (`valheim-link-token.helpers.ts`): `rlvl_` + 32 random bytes (base64url). Only the sha256 hash and a 4-char hint are stored, compared in constant time. These tokens are **per game server**, issued by an admin (`admin/plugins/valheim/link-tokens`).
- **LedgerLink**
  - Contract docs: `packages/contract/ledgerlink/v1/`. Zod: `wow-addon-export.schema.ts` + `wow-addon-import.schema.ts`.
  - Wire format: `!RL1!<section>[-nOfm]!<base64(zlib(JSON))>`.
  - Decoder: `api/src/plugins/wow-common/addon-import/addon-import.decoder.ts`. Endpoints: `POST /plugins/wow/characters/addon-import` and `/:id/addon-import`, both owner-only.
- **Hub widgets** (`web/src/plugins/hub-game-widgets.ts`, ROK-1909)
  - Plugins call `registerHubWidget({ id, title, description, defaultOn, games, kinds?, order, span, audience: 'everyone'|'members'|'editors', component: lazy(...) })`. Valheim's `register.ts` (Deaths widget, claim banner) is the worked example.
  - Layouts are saved per hub in `guild_profiles.widget_prefs` (ROK-1918).
- **Gallery (ROK-1942, Backlog, design-first):** one hub media store keyed by provenance (idempotent), with local files under `/data/uploads/hub-media/` re-encoded with `sharp`. Sources plug in, and the widget renders via `registerHubWidget`.

### 3.2 Components

```
┌──────────── Companion (Tauri v2, tray) ────────────┐         ┌──────────── Raid Ledger API ─────────────┐
│ Collector runtime                                  │         │ POST /companion/v1/devices/link (start)  │
│  ├ manifest: bg3-save@1   ── watch → settle        │         │ POST /companion/v1/devices/link/approve  │ ← signed-in web user
│  │   parse (Rust: LSPK → SaveInfo.json + WebP)     │         │ POST /companion/v1/devices/link/poll     │
│  ├ manifest: wow-ledgerlink@1 (SavedVariables)     │  HTTPS  │ GET  /companion/v1/config (contracts,    │
│  └ …                                               │ ──────▶ │      min app version, kill switches)     │
│ Preview + per-game opt-in (React UI)               │ Bearer  │ POST /companion/v1/messages/:contract    │──▶ contract router
│ Offline queue (SQLite, latest-wins per key)        │ rlcd_…  │ PUT  /companion/v1/blobs/:sha256         │──▶ media store (ROK-1942)
│ Token in OS keychain · updater (signed)            │         └──────────────────────────────────────────┘
└────────────────────────────────────────────────────┘                    │ plugin handlers (bg3, wow-common)
                                                                           ▼
                                                            hub widgets via registerHubWidget
```

### 3.3 Collectors are declared manifests

Collector **code** (watch + parse) is compiled into the app. A new collector ships as an app update, never as downloaded code. The **manifest** is data in the signed build. The server can only disable a collector or raise `minAppVersion`, through `/companion/v1/config`.

```jsonc
{
  "id": "bg3-save",
  "game": { "slug": "baldurs-gate-3", "steamAppId": 1086940 },   // slug: confirm against games table
  "contract": { "id": "bg3-save", "version": 1 },
  "watch": {
    "windows": ["%LOCALAPPDATA%/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story",
                "%USERPROFILE%/Documents/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story"],
    "macos":   ["~/Documents/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story"],
    "linux":   ["~/.steam/steam/steamapps/compatdata/1086940/pfx/drive_c/users/steamuser/AppData/Local/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story"],
    "glob": "*/*.lsv", "recursive": true,
    "settleMs": 5000                      // wait until size+mtime stop changing; reject if the LSPK table fails to parse
  },
  "parse": "bg3.saveinfo",               // LSPK v18 → SaveInfo.json (+ meta.lsf GameID/SaveTime if Q7 = yes)
  "blobs": ["thumbnail"],                 // the in-package <SaveName>.WebP → PUT /blobs/:sha256
  "cadence": { "minIntervalSec": 120, "latestWinsKey": ["campaignKey"] },
  "privacy": { "fields": ["party[].race", "party[].classes", "party[].level", "party[].xp", "party[].origin",
                          "currentLevel", "difficulty", "gameVersion", "savedAt"],
               "neverSend": ["raw .lsv", "Globals.lsf", "StorySave.bin", "Position", "file paths"] },
  "optIn": "per-game"
}
```

- The user can override any path.
- Tauri's fs scope grants read/watch **only** on the declared roots: `deny` beats `allow`, and `..` traversal is blocked. SOURCED: [Tauri fs plugin](https://v2.tauri.app/plugin/file-system/).
- `Position` is dropped client-side. It is world coordinates with no hub use in v1.

### 3.4 Auth: per-user device token

ValheimLink's token is per game server and issued by an admin. The companion's is **per user, per device**:

1. On first run the app calls `POST /devices/link` and shows a short code plus a link. This is the OAuth device-authorization pattern (RFC 8628).
2. The user approves while signed in. The approve page names the device's hostname and the games it asks for.
3. The app polls and receives `rlcd_<32 bytes base64url>` once. The server stores only the sha256 hash plus a hint; extract the ValheimLink helpers into a shared module.
4. The token sits in the OS keychain (Windows Credential Manager or macOS Keychain).
5. Scope: `companion:ingest` only. It is never a session.
6. Profile → **Devices** lists tokens with last-seen time, and allows revoke and rename.
7. The device code has a short TTL and is single use.

### 3.5 One ingest endpoint, routed by contract

- `POST /companion/v1/messages/:contract` accepts JSON (gzip allowed). The envelope is `{ contract, contractVersion, capturedAt, appVersion, collectorVersion, payload }`.
- A **contract registry** maps `(contract, version)` to `{ zodSchema, maxBytes, handler }`, registered by plugins. Unknown contract → 404 `unknown_contract`. Retired version → 409 telling the app to update.
- Reuse from ValheimLink: the bounded body reader (decoded-size cap), the bearer guard pattern, the rate limiter, `accepted|stale`, the 5-min future-clock rejection, and blobs by sha256 (`PUT /companion/v1/blobs/:sha256`, either order). WebP replaces the PNG IHDR check with a VP8/VP8L/VP8X header width/height check before decode.
- **Contracts are Raid Ledger-owned and versioned** like LedgerLink and ValheimLink: `packages/contract/companion/<contract>/v1/{CONTRACT.md,schema.json,fixtures/,CHANGELOG.md}`, Zod in `packages/contract/src/companion-*.schema.ts`, with a drift guard. Additive changes stay v1; breaking changes open v2 and the server accepts the current and previous versions.
- **`bg3-save/v1` payload** mirrors §2.1, normalised to camelCase:
  - `party[]` items are `{ origin, race, level, xpLevel, xpTotal, classes[{main, sub}], isSummon }`.
  - Plus `currentLevel`, `difficulty`, `ruleset`, `gameVersion`, `platform`, `saveName`, `savedAt` (mtime), `campaignKey`, and `thumbnail` as a blob ref.
  - Fixtures come from the operator's save **after anonymisation** (§9 Q10).
- **`wow-ledgerlink/v1`** is `payload: { exportString }`. The handler calls the existing `addon-import` decoder, so the LedgerLink format is untouched.

### 3.6 Offline queue

- Local SQLite, collapsed by `latestWinsKey`, so ten offline saves become one upload. Session history still gets one row per *uploaded* save.
- Exponential backoff. 4xx (other than 408/429) is terminal and surfaced in the tray. 401 asks the user to re-link.
- An idempotency key (the payload's sha256) makes a replay harmless.

### 3.7 Local preview and opt-in

- Every collector starts **off**. Enabling it shows what was found ("14 BG3 saves") and a **preview** of the exact payload (rendered + JSON) and the thumbnail.
- The first upload, and the first after a contract version change, waits for "Upload". After that it is automatic, with per-game pause and "upload now".
- A local upload log (time, contract, bytes) lives in the app.

### 3.8 Update channel

- The Tauri updater requires signatures ("This cannot be disabled"). The private key comes from `TAURI_SIGNING_PRIVATE_KEY`, and losing it strands installs.
- Feeds: a static JSON feed (GitHub Releases) or a dynamic endpoint taking `{{target}}`, `{{arch}}` and `{{current_version}}`.
- Bundles: Windows MSI/NSIS, macOS `.app.tar.gz`, Linux AppImage. SOURCED: [Tauri updater](https://v2.tauri.app/plugin/updater/).
- **Stable** and **beta** feeds. `/companion/v1/config` returns `minAppVersion`; below it the app stops uploading and prompts an update.

---

## 4. Tech choice

| | **Tauri v2** | **Electron** | **.NET (Avalonia / MAUI) + Velopack** |
|---|---|---|---|
| Installer size | ~2–10 MB (system WebView) [devtoolpicks](https://devtoolpicks.com/blog/tauri-vs-electron-indie-hackers-2026), [pkgpulse](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) | ~80–200 MB (bundled Chromium) | self-contained ~40–80 MB (UNVERIFIED) |
| UI stack | React/TS (team's) | React/TS | C# XAML: a new stack |
| BG3 parse | Rust: own LSPK reader or `bg3rustpaklib` (MIT) + zstd; same crate → WASM for the web | Node: ~60-line LSPK reader + zstd/lz4 npm | **LSLib in-process**: the only `Globals.lsf` route today |
| File watching | `fs` `watch` / `watchImmediate`, scoped allow/deny [docs](https://v2.tauri.app/plugin/file-system/) | chokidar | `FileSystemWatcher` |
| Tray | core tray-icon feature | `Tray` | Avalonia `TrayIcon`; MAUI weak on desktop |
| Auto-update | built in, signatures mandatory [docs](https://v2.tauri.app/plugin/updater/) | electron-updater | Velopack |
| Windows signing | OV/EV thumbprint, or `signCommand` with Azure Key Vault (relic) or **Azure Artifact Signing**. Since 2024 EV and OV build SmartScreen reputation the same way [docs](https://v2.tauri.app/distribute/sign/windows/) | same; electron-builder | same |
| macOS | Developer ID + notarisation ($99/yr Apple program, recalled); WebKit WebView | notarisation; Hardened Runtime vs native modules [forasoft](https://www.forasoft.com/blog/article/the-pain-of-publishing-electron-apps-on-macos-303) | notarisation; LSLib on macOS not stated |
| Risk | Rust new to the repo; WebView differences | size; RAM (~168 vs ~42 MB idle, one benchmark) | team stack; LSLib Windows-leaning |

**Recommendation: Tauri v2.**
- The real save shows v1 needs only `SaveInfo.json` + the WebP, both trivially reachable without LSLib. That removes .NET's one advantage.
- If `Globals.lsf` is ever wanted, run Divine **server-side** (opt-in raw upload, Linux .NET 8 container) instead of shipping .NET to players.
- Parsers live in one Rust crate (`rl-collectors`), built native for Tauri and to WASM for the web drop-zone.
- Repo: its own repo, like `rl-valheim-link`. Contracts stay in Raid Ledger.

---

## 5. Security and privacy

- **What leaves the machine:** only the manifest's fields plus the thumbnail.
  - Never the raw `.lsv`, `Globals.lsf`, `StorySave.bin`, `Position`, file paths, the OS username or a hardware id.
  - The device name is user-editable.
  - The sample's `SaveInfo.json` holds **no names or account ids**, which keeps the v1 payload low-risk.
- **Opt-in:** per game, default off. A preview appears before the first upload and on every contract bump. Pause is available. Revoking the device token stops uploads. "Delete my BG3 data" on the web removes snapshots and media.
- **Token:** user-scoped, ingest-only, hashed at rest, constant-time compare, revocable, never logged (log the user id). Rate-limited per token.
- **Server-side validation:** strict Zod (no unknown keys), a decoded-size cap per contract (gzip-bomb guard, as in ValheimLink §1), and image header dimension + hash checks before decode. Thumbnails are re-encoded with `sharp`.
- **App hardening:**
  - Tauri capabilities grant read/watch only on declared roots, with no write and no shell.
  - No remote code: collectors are compiled in and manifests ship in the signed build.
  - The server config can only disable collectors or set `minAppVersion`.
  - Signed updates and code-signed binaries.
- **Visibility:** BG3 widgets default to `audience: 'members'`, enforced server-side like the Deaths widget.
- **Steam:** only for users who linked it. Private game details get an explicit empty state.
- **Spoilers:** the area and the screenshot can spoil the campaign for members who are behind. A hub toggle handles it (§9 Q9).
- **Handling of this spike's sample:** the operator's save was copied into a scratch directory, read locally and not uploaded. No personal values are written here.

---

## 6. WoW collector sketch

**Operator ruling 2026-10-04** (`docs/spikes/wow-forever-addon-spike.md`): copy+paste export string; "NOT a SavedVariables file upload, NOT a desktop companion for v0". SV upload was rejected for v0 because of the friction of finding `WTF/…` and the risk of parsing Lua. The companion removes both. This section exists only if §9 Q1 is approved.

1. **LedgerLink change** (addon repo; **not a format change**). After `/rl export` or on logout, the addon writes its latest page tokens to SavedVariables, e.g. `LedgerLinkDB.outbox = { { capturedAt=…, tokens={"!RL1!char!…", …} } }`. Alert the LedgerLink agent per the contract rule.
2. **Files.** WoW writes SV on logout, `/reload` or exit, which is fine for latest-wins.
   - Paths: `<WoW>/_<flavor>_/WTF/Account/<ACCOUNT>/SavedVariables/LedgerLink.lua` and `…/<Realm>/<Character>/SavedVariables/LedgerLink.lua`. The Forever flavor folder is UNVERIFIED.
   - Default install: `C:\Program Files (x86)\World of Warcraft` or `/Applications/World of Warcraft`. The user can override it.
3. **Parse.** No Lua interpreter. Regex-extract the string literals that match `ADDON_IMPORT_PAGE_RE`. The base64 alphabet needs no Lua escapes.
4. **Upload.** `POST /companion/v1/messages/wow-ledgerlink` with `{ exportString }`. The existing decoder and apply services run, so validation, guild trust and audit are unchanged. The owner is the token's user (the ROK-1738 no-id path).
5. **Known risk:** the Forever beta SV *load* bug only affects the addon's own buffer, not what the companion reads.

---

## 7. BG3 hub v1 widgets (Q4)

- Register them in a new `web/src/plugins/bg3/register.ts` with `games: ['<bg3 slug>']` (confirm the slug) and `audience: 'members'`. They are arrangeable (ROK-1918).
- **Wireframe first**, filed in `planning-artifacts/pending-approval/`.
- Widgets read the hub's **active campaign**, which an editor can switch (§9 Q6).

| Widget | Data | Source | Needs |
|---|---|---|---|
| **Party** (span 2) | One card per party member: race, class/subclass (multiclass chips), level + XP-to-next bar, "custom" vs origin companion; summons collapsed; the linked RL member via claim | `SaveInfo.json` (**VERIFIED**) | names: claim or LSF (§9 Q7) |
| **Where we are** (span 1) | Act + area (id→name table), difficulty + ruleset (e.g. "Tactician"? map `DifficultyHard`), game version, "saved 2 h ago", latest WebP | `SaveInfo.json` + WebP (**VERIFIED**) | display tables |
| **Session history** (span 2) | One row per play session (saves clustered by a ≥4 h gap): date, duration (first→last save, or Discord voice), act/area changes, level-ups; link to an overlapping RL event | uploads history (+ Discord voice, events) | ingest stores history (unlike ValheimLink's latest-only) |
| **Gallery source** | Each upload's WebP → ROK-1942 media store, source `bg3-save`, provenance `campaignKey + savedAt` | WebP | ROK-1942 |
| **Achievements** (span 1) | Recent unlocks with rarity; X/Y per member | Steam | Steam link + public game details |
| **Playtime** (span 1) | Hours per linked member | Steam `GetOwnedGames` | Steam link |

**Later, needs `Globals.lsf`:** gold, gear, ability scores/feats, approval, quest progress. All patch-fragile.

---

## 8. v1 story list (each ~1–3 lanes)

| # | Story | Lanes | Depends on |
|---|---|---|---|
| S1 | `feat(steam):` BG3 achievements + playtime for hub members. Add `GetPlayerAchievements` / `GetSchemaForGame` / global % to `steam-http.util.ts`, daily refresh, read route, two widgets, private-profile empty state | 2–3 | none (ship first) |
| C1 | `feat(contract):` `packages/contract/companion/` envelope + registry types + `bg3-save/v1` (CONTRACT.md, schema.json, **anonymised** fixtures from the operator's save, CHANGELOG, drift guard) + level-id/difficulty display tables | 1–2 | (C0 done in this spike) |
| C2 | `feat(api):` companion device tokens: link/approve/poll, hashed `rlcd_` tokens (shared helper extracted from ValheimLink), Devices list + revoke on profile | 2–3 | none |
| C3 | `feat(api):` `POST /companion/v1/messages/:contract` + `PUT /blobs/:sha256` (WebP header check) + contract registry + `/config` | 2 | C1, C2 |
| C4 | `feat(bg3):` BG3 plugin: snapshot + history store, campaign→hub binding, party claims, read routes, members-only guard | 2 | C3 |
| C5 | `feat(web):` BG3 hub widgets: Party, Where we are, Session history (wireframe first) | 2–3 | C4 |
| C6 | `feat(hub):` Gallery source `bg3-save` | 1 | C4, ROK-1942 |
| W0 | `feat(web):` drag-and-drop `.lsv` upload on the BG3 hub (parse in-browser via `rl-collectors` WASM, send summary + WebP only, through C3) | 1–2 | C3, D2 crate |
| D1 | `feat(companion):` Tauri shell (own repo): tray, device-link sign-in, keychain, collector runtime + manifest loader, offline queue, preview + per-game opt-in | 3 | C2, C3 |
| D2 | `feat(companion):` `rl-collectors` Rust crate: LSPK v18 reader (LZ4 table, zstd entries), `SaveInfo.json` + WebP extract, settle-watcher; fixture tests (native + WASM) | 2 | C1 |
| D3 | `chore(companion):` release pipeline: Windows signing (Artifact Signing), macOS notarisation, updater feeds (stable/beta), CI builds | 2 | D1, operator certs |
| D4 | *(if §9 Q7 = yes)* minimal LSF v7 reader in `rl-collectors` for `meta.lsf` `GameID` + `SaveTime` | 2 | D2 |
| L1 | *(after §9 Q1)* LedgerLink `outbox` in SV (addon repo) + `wow-ledgerlink` contract + collector | 2 | D1 |

Suggested order: **S1** ∥ **C1 → C2/C3 → C4 → D2 → W0 → C5**, then **D1 → D3**. C6, D4 and L1 slot in when ready.

---

## 9. Open questions for the operator (each with a recommendation)

1. **WoW: revisit the 2026-10-04 "paste only" ruling?**
   *Rec:* keep paste as the default and add the SV collector as an **optional** path (L1). The format and decoder are unchanged.
2. **Ship the browser drag-and-drop `.lsv` upload (W0) before the desktop app?**
   *Rec:* yes. It proves contract → ingest → widgets end to end with zero install. The companion then automates it with the same parser (WASM).
3. **Companion repo:**
   *Rec:* its own (`Raid-Ledger-Plugins/rl-companion`), with contracts owned in Raid Ledger.
4. **Stack: Tauri v2?**
   *Rec:* yes (§4). Rust stays scoped to one crate plus a thin shell.
5. **Platforms and signing spend** (Apple $99/yr; Azure Artifact Signing or an OV cert)?
   *Rec:* Windows + macOS signed. Linux/Steam Deck AppImage best-effort. An unsigned beta for the group meanwhile.
6. **Who uploads, and how does a save map to a hub?**
   *Rec:* any hub member may run the collector. The uploader binds a campaign to a hub on the web. The **host's** saves are canonical when several members upload. Dedupe by campaign key + save time.
7. **Character names and campaign key live only in LSF, not `SaveInfo.json`. Build a small `meta.lsf` reader (D4), or use manual claims plus the save-folder name?**
   *Rec:* claims + folder name for v1. Do D4 only if grouping saves into campaigns proves unreliable.
   *Review note (Codex, 2026-10-25):* BG3 writes a new folder per save, so the folder name alone would split one playthrough into many campaigns. Group by the `meta.lsf` GameID (ROK-1967) when available, else by a manual "this save belongs to campaign X" assignment on the web; the folder name is only a dedupe hint. `bg3-save/v1` (ROK-1954) keeps the campaign key client-supplied and optional.
8. **`Globals.lsf` (gold, approval, gear, quests), ever?**
   *Rec:* not in v1. Later, server-side LSLib on an opt-in raw upload, accepting breakage on patches.
9. **Visibility and spoilers:**
   *Rec:* members-only, plus a per-hub "hide location and screenshots" toggle, default off.
10. **Fixtures from your save:** OK to commit an anonymised `SaveInfo.json` (no names or ids exist in it; `Position` zeroed) and a re-encoded small thumbnail as golden fixtures?
    *Rec:* yes for the JSON. Use a synthetic placeholder image instead of your party's screenshot.
11. **Session history retention:**
    *Rec:* every save for 90 days, then one per session. Thumbnails follow ROK-1942's retention ruling.
12. **Ship S1 (Steam) now, ahead of the companion?**
    *Rec:* yes.

---

## Sources

- LSLib: https://github.com/Norbyte/lslib · releases https://github.com/Norbyte/lslib/releases · package format https://github.com/Norbyte/lslib/blob/master/LSLib/LS/PackageFormat.cs
- bg3-save-tools: https://github.com/CharlesMcquade/bg3-save-tools
- bg3-save-skill: https://github.com/hylqs97/bg3-save-skill
- bg3-newage: https://github.com/marius851000/bg3-newage · https://github.com/LennardF1989/BG3-ImHex-Patterns
- bg3-save-editor: https://github.com/Serofix-code/bg3-save-editor
- bg3rustpaklib: https://docs.rs/bg3rustpaklib · zstd-rs https://docs.rs/zstd-rs
- Save location: https://gamepretty.com/baldurs-gate-3-save-file-location-how-to-save/ · https://steamcommunity.com/app/1086940/discussions/0/3812913197990431217
- Steam: https://partner.steamgames.com/doc/webapi/ISteamUserStats · https://developer.valvesoftware.com/wiki/Steam_Web_API · https://github.com/AndreVarandas/steam
- Tauri: https://v2.tauri.app/plugin/updater/ · https://v2.tauri.app/plugin/file-system/ · https://v2.tauri.app/distribute/sign/windows/
- Tauri vs Electron: https://devtoolpicks.com/blog/tauri-vs-electron-indie-hackers-2026 · https://www.pkgpulse.com/guides/electron-vs-tauri-2026 · https://www.forasoft.com/blog/article/the-pain-of-publishing-electron-apps-on-macos-303
