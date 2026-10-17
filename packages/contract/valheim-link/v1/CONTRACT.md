# RL Valheim Link ↔ Raid Ledger wire contract — v1

The **RL Valheim Link** BepInEx mod (`github.com/Raid-Ledger-Plugins/rl-valheim-link`)
**pushes** JSON messages to a Raid Ledger ingest endpoint. Raid Ledger never
reads files on the game server (operator ruling). **Raid Ledger owns this
format** exactly like LedgerLink (`CLAUDE.md` → "LedgerLink addon contract"):
only a Raid Ledger PR touching this folder changes it; the mod pins a copy of
`v1/` and validates against it in its own CI. Design background:
`docs/spikes/ROK-1799-valheim-armory.md` (Q2–Q6). Story: ROK-1829.

| Artifact | Where |
|---|---|
| Zod source of truth | `packages/contract/src/valheim-link-{common,character,map,items,message}.schema.ts` |
| JSON Schema of one message (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |

## 1. Transport

The endpoint itself is ROK-1833; this section is what the mod may rely on.

- `POST` one message per request, `Content-Type: application/json`, UTF-8.
  `Authorization: Bearer <per-server token>`. The token is issued by Raid
  Ledger for one game server; `serverId` in the body must be that server's
  id, or the message is rejected.
- The body may be sent with `Content-Encoding: gzip`. The size caps (§7) apply
  to the **decoded** JSON; the server inflates with the kind's cap as its
  output limit, so a gzip body can never expand past it.
- Binaries (the base-map PNG and the icon atlas) are **not** in the JSON. A
  message references them by `{ sha256, byteLength, contentType, width,
  height }`, and the mod uploads the bytes separately (ROK-1833 defines the
  route; proposal: `PUT …/blobs/<sha256>` with the raw PNG). Raid Ledger
  checks the hash and length, and reads the PNG's `IHDR` width/height and
  rejects the blob unless they equal the reference's `width`/`height`
  **before** decoding any pixels (a 16 384² decode is 1 GiB). It accepts the
  message and its blob in either order.
- Latest wins: Raid Ledger keeps the newest `capturedAt` per snapshot key and
  ignores an older one. No history in v1. Keys always include `serverId`,
  because a Valheim character is portable and may be pushed by several
  servers — one server's token can never overwrite another server's snapshot:
  `character` → (`serverId`, `steamId`, `playerId`); `map` → (`serverId`,
  `steamId`, `playerId`, `worldUid`); `items` → (`serverId`, `gameVersion`).
- Clock skew: the server **rejects** a message whose `capturedAt` is more than
  5 minutes (`VALHEIM_LINK_CAPTURED_AT_MAX_FUTURE_MS`) past its own clock, so
  a bad game-server clock cannot pin a snapshot as "latest" forever.

## 2. Header (every message)

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `1` | Contract version. The mod emits **exactly one**. |
| `kind` | `"character"` \| `"map"` \| `"items"` | Discriminator (§3–§5). |
| `serverId` | string `^[A-Za-z0-9_-]{1,64}$` | Raid Ledger's id for the game server, issued with the token. |
| `capturedAt` | ISO-8601 UTC, `Z` offset (`2026-10-17T20:15:00Z`), at most 3 fractional digits (≤ 24 chars) | When the mod read the data. Not later than server time + 5 min (§1). |
| `gameVersion` | `^\d{1,4}(\.\d{1,5}){1,3}$` (`0.220.5`) | `Version.GetVersionString()`. |
| `modVersion` | SemVer (`1.0.0`, `1.2.0-beta.1`) | The mod's own version. |

Shared value types:

| Type | Format | Notes |
|---|---|---|
| SteamID64 | decimal **string**, 17 digits, ≥ `76561197960265728` (the individual-account base) | Exceeds JS safe integers; never a JSON number. No fixed `7656119` prefix — it rolls over to `7656120…` past account id ~2.04 B. |
| int64 id (`playerId`, `worldUid`) | canonical decimal string `^(0\|-?[1-9]\d{0,18})$`, within −9223372036854775808…9223372036854775807 | .NET `long`; opaque to Raid Ledger. No leading zeros or `-0`, so one id has exactly one spelling. |
| prefab id | `^[A-Za-z0-9_.-]{1,96}$` | The game's prefab name (`SwordIron`), never a `$item_…` localisation token. |
| sha256 | 64 lowercase hex | Of the uploaded binary. |

## 3. `kind: "character"` — character summary

Sent on every vanilla save broadcast, on logout and on quit.

| Field | Type | Meaning |
|---|---|---|
| `character.steamId` | SteamID64 | Owner's Steam account; Raid Ledger matches it to `users.steam_id`. |
| `character.playerId` | int64 string | `Player.GetPlayerID()` — **the key**. One Steam account may own several characters. |
| `character.name` | 1–32 chars | Free text; display only, never used to claim. |
| `character.worldUid` / `worldName` | int64 string / 1–64 chars | The world it was captured on; opaque. |
| `equipment[]` (≤ 32) | `{ slot, item }` | One entry per occupied slot; `slot` unique. `slot` ∈ `head chest legs shoulder utility trinket rightHand leftHand ammo`. |
| `inventory.grid` | `{ width 1–32, height 1–32, extraRows[] }` | Explicit size. Vanilla 8×4. Inventory mods (EquipmentAndQuickSlots, Extended Player Inventory) add rows; `extraRows` lists **exactly** the rows past the vanilla four — every `y` in `[4, height)` once, nothing else (empty when `height ≤ 4`) — as `{ y, purpose }`, `purpose` ∈ `equipment quickslot extended other`. |
| `inventory.items[]` (≤ 512) | `{ x, y, equipped, item }` | 0-based grid cell, `x < width`, `y < height`, one stack per cell. `equipped` = also listed in `equipment`. |
| `skills[]` (≤ 128) | `{ id, level, accumulator }` | `id` = `Skills.SkillType.ToString()` (a name for vanilla, a signed integer string for a modded skill), unique. `level` 0–100 float; `accumulator` ≥ 0 float (progress toward the next level, game units). |
| `trophies[]` (≤ 1024) | prefab ids | `m_trophies`. |
| `knownItems[]` (≤ 8192) | prefab ids | Discovered materials/items (`m_knownMaterial`). |
| `knownRecipes[]` (≤ 8192) | prefab ids | Craftable recipe item ids (`m_knownRecipes`). |

Item stack (`item`): `prefab`; `stack` 1–100 000; `quality` 1–10 (1-based
upgrade level); `variant` 0–63; `durability` and `maxDurability` — durability
points (float ≥ 0), both `null` together when the item has no durability.
Not sent: crafter name/id, custom data, food, stats, appearance, home or
spawn points.

## 4. `kind: "map"` — exploration and pins

One message per character **per world**.

| Field | Type | Meaning |
|---|---|---|
| `character` | `{ steamId, playerId, worldUid }` | Which character's map, on which world. |
| `grid.textureSize` | int 64–4096 | Minimap texture edge in pixels. |
| `grid.pixelSizeMetres` | number > 0 | World metres per pixel. |
| `explored` | bitmap | The player's own exploration (personal fog — the default layer). |
| `sharedExplored` | bitmap \| `null` | The shared cartography-table layer, or `null` when not included. The web shows it as a toggle (operator ruling). |
| `pins[]` (≤ 2000) | pin | Map pins. |
| `baseMap` | binary ref \| `null` | The world's rendered base map, or `null` until rendered. |

**Grid — UNVERIFIED constants.** From the decompiled `Minimap`, vanilla is
`textureSize = 2048`, `pixelSizeMetres = 12`, world origin at the texture
centre, so the map spans 24 576 m. Pixel of a world point:
`px = x / pixelSize + textureSize / 2`, `py = z / pixelSize + textureSize / 2`;
image row `= textureSize − 1 − py`. Raid Ledger reads the constants from the
message and never hardcodes them.

**Bitmap.** `{ encoding: "gzip+base64-bitset-lsb0", width, height, data }`.
`width` = `height` = `grid.textureSize`. Packed bitset, row-major: pixel
(px, py) is bit `i = py · width + px`, stored in byte `i >> 3` at bit `i & 7`
(least significant first); `1` = explored; `py = 0` is the **south** edge. The
`⌈width·height/8⌉` bytes (`valheimLinkBitmapBytes(width, height)`) are
compressed as **one gzip member** with a plain 10-byte header (magic
`1f 8b 08`, `FLG = 0` — no name, comment, extra field or header CRC, which is
what .NET `GZipStream` and zlib write; `data` starts with `H4sI`) and nothing
after its 8-byte trailer, then standard padded base64 (RFC 4648 §4). `data` is 28–3 000 000
chars, a multiple of 4, and at most the base64 length of
`valheimLinkBitmapMaxGzipBytes(width, height)` (raw + raw/8 + raw/64 + 64 —
zlib's conservative deflate bound; anything larger is not an honest
compression of the bitset). The server's inflate rule is in §6.

**Pin.** `type` = `Minimap.PinType.ToString()` (`Icon0`…`Icon4`, `Death`,
`Bed`, `Shout`, `Boss`, `Hildir1`…; open set, unknown types get a generic
icon); `label` ≤ 64 chars (player free text, may be empty — never logged);
`x`, `z` world metres (|v| ≤ 32 768; `x` east-west, `z` north-south);
`checked` (the red cross); `shared` (came from a cartography table).

**Base map.** Rendered by the **server half** of the mod from the game's own
`WorldGenerator`, **once per (world uid, game version)**, as a
`textureSize × textureSize` PNG aligned to the grid above (vanilla 2048×2048,
12 m/px, origin centre — UNVERIFIED). The seed never leaves the server; only
the PNG does. `baseMap` = `{ sha256, byteLength, contentType: "image/png",
width, height }` with `width` = `height` = `grid.textureSize` (Zod-enforced);
the server checks the uploaded PNG's real dimensions against it (§1).

## 5. `kind: "items"` — item catalogue export

Once per game version, and again whenever the server's mod set changes.
Names and icons come from the mod's ObjectDB export (operator ruling), so
modded items work and the names match the installed build.

| Field | Type | Meaning |
|---|---|---|
| `locale` | `^[A-Za-z_-]{2,32}$` | Valheim language of the names (`English`). |
| `atlas` | binary ref \| `null` | The icon atlas PNG. Required when any item has an `atlas` icon. |
| `items[]` (1–10 000) | definition | `prefab` unique. |

Definition: `prefab`; `name` 1–96 (localised display name); `category` =
`ItemDrop.ItemData.ItemType.ToString()` (`OneHandedWeapon`, `Helmet`,
`Material`, `Trophy`…; open set); `maxStack` 1–100 000; `maxQuality` 1–10;
`variants` 0–64; `icon` (variant 0) = one of
`{ kind: "atlas", x, y, w, h }` (sprite rect in atlas pixels, top-left
origin, inside the atlas) · `{ kind: "file", file: "<name>.png" }` (a
separately uploaded PNG) · `null` (no sprite).

## 6. Strict keys and refinements

Every object is **strict**: an unknown key rejects the whole message. These
rules are enforced by the Zod schema but **cannot be expressed in
`schema.json`** — the mod must honour them too:

- inventory cells inside the grid and unique; `extraRows` = exactly the rows
  `4 … height − 1`, each once;
- `equipment[].slot` and `skills[].id` unique; `items[].prefab` unique;
- `durability` and `maxDurability` null together;
- both bitmaps and `baseMap` exactly `grid.textureSize` square;
- bitmap `data` length a multiple of 4 and within the size-tied gzip cap (§4);
- int64 ids inside the signed 64-bit range; SteamID64 ≥ the individual base;
- an `atlas` icon needs a non-null `atlas` and must lie inside it.

**Server-enforced (not in Zod, not in `schema.json`).** The contract package
stays synchronous and browser-safe, so it never inflates. The ingest endpoint
(ROK-1833) **MUST**, for every non-null bitmap:

1. base64-decode `data` and gunzip it with
   `maxOutputLength = valheimLinkBitmapBytes(width, height)` (Node
   `zlib.gunzipSync(buf, { maxOutputLength })`, or an equivalent bounded
   inflater) — never an unbounded inflate;
2. **reject** the message on any decode error (bad header, corrupt data, CRC
   or length-trailer mismatch, truncated stream, output over the limit);
3. **reject** unless the inflated length is **exactly**
   `valheimLinkBitmapBytes(width, height)`.
4. **reject** unless `data` is **one** gzip member: header byte 3 (`FLG`) is
   `0`, and a bounded raw inflate (`zlib.inflateRawSync(buf.subarray(10,
   buf.length - 8), { maxOutputLength, info: true })`) consumes every byte
   between the header and the trailer (`engine.bytesWritten` equals that
   length). Node's gunzip silently joins concatenated members, so steps 1–3
   alone accept two members whose outputs add up to the right length.

It also enforces the `capturedAt` skew rule and the PNG `IHDR` check (§1).
`api/src/plugins/valheim/valheim-link-contract.spec.ts` pins this rule
against truncated, corrupt-CRC, short, 64× "bomb" and two-member gzip that
all pass Zod.

## 7. Size caps (exported constants — for ROK-1833 limits)

| Constant | Value | Applies to | Typical |
|---|---|---|---|
| `VALHEIM_LINK_CHARACTER_MAX_BYTES` | 2 097 152 (2 MiB) | one `character` body | 10–40 KB. Largest schema-valid ≈ 1.9 MB |
| `VALHEIM_LINK_MAP_MAX_BYTES` | 8 388 608 (8 MiB) | one `map` body | tens to a few hundred KB (UNVERIFIED). Largest schema-valid (two 3 M-char layers, 2 000 pins) ≈ 7.0 MB |
| `VALHEIM_LINK_BITMAP_DATA_MAX_CHARS` | 3 000 000 | one bitmap's `data` | a 2048² mask is 512 KiB raw before gzip; ≤ ~700 KB base64 even if incompressible |
| `VALHEIM_LINK_BITMAP_EDGE_MAX` | 4096 | `textureSize`, bitmap edges | 2048 vanilla |
| `VALHEIM_LINK_ITEMS_MAX_BYTES` | 10 485 760 (10 MiB) | one `items` body | ~150 B per item; ~2 000 vanilla items ≈ 300 KB. Largest schema-valid ≈ 9.4 MB |
| `VALHEIM_LINK_BINARY_MAX_BYTES` | 16 777 216 (16 MiB) | one uploaded PNG (base map, atlas) | base map a few MB; a 64 px atlas of ~3 000 icons ≈ 8–12 MB (UNVERIFIED) |
| array caps | see §3–§5 | | |

The body caps were **raised** (not the array caps tightened) so that each is
≥ the largest message the schema accepts — every array full, every string at
its max length, free text made of control characters that JSON escapes to 6
bytes each. A schema-valid message therefore never trips a body cap; the
array and string caps are what bind. Recompute and raise these if an array or
string cap grows.

## 8. Fixtures

All values are synthetic: SteamID64s `765611980000000xx`, invented names
(`Testviking`, `Fixtureheim`), no seeds, no real world names.

- `fixtures/<name>.json` — a message that **must parse**. Map bitmaps must
  inflate to exactly `⌈width·height/8⌉` bytes.
- `fixtures/invalid/<name>.json` — a message that **must be rejected by the
  schema**;
  `fixtures/invalid/EXPECTED.json` maps each name to the `{ path, code }` of
  the Zod issue it must raise (path joined with `.`, `""` = root).

Regenerate (Raid Ledger side only), from the repo root:

```
node packages/contract/scripts/gen-valheim-link-fixtures.mjs
npm run build -w packages/contract && node packages/contract/scripts/gen-valheim-link-schema.mjs
```

The api jest spec `api/src/plugins/valheim/valheim-link-contract.spec.ts`
checks every fixture and fails CI when `schema.json` drifts from the Zod
source. The mod should serialise its own captures and validate them against
its pinned `schema.json` **and** these fixtures; it must not keep an edited
copy.

## 9. Versioning

- The contract version is `schemaVersion` (`VALHEIM_LINK_SCHEMA_VERSION`).
- **Stays v1 (additive):** a new **optional** field the server can ignore, or
  a new value in a closed enum (`slot`, `purpose`, `kind` of icon). Every
  object is strict, so the **server ships first** (Zod + `schema.json`
  released), then the mod may emit it. A mod that emits a field the deployed
  server doesn't know is rejected.
- **Requires v2 (breaking):** renaming or removing a field, making an
  optional field required, changing a type, unit, range or enum spelling,
  changing the bitmap encoding or bit order, or changing the transport.
  v2 lives in a new `valheim-link/v2/` folder with its own schema, fixtures
  and changelog; `v1/` is frozen from then on.
- **Transition:** during a version change the server accepts the current
  **and** the previous version; the previous one is dropped only after the
  operator confirms the mod has shipped the new one.

## 10. Change process

1. A Raid Ledger PR touching this folder is the only way to change the
   format. It updates the Zod source, regenerates `schema.json` and the
   fixtures, adds a `CHANGELOG.md` entry, and its PR body says **additive**
   or **breaking**.
2. The mod requests a change through a Raid Ledger story; it never changes
   the format on its own.
