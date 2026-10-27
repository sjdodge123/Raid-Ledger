# Raid Ledger Companion `bg3-save` wire contract — v1

**Owner: Raid Ledger.** One Baldur's Gate 3 save, read by the Companion's
`bg3-save` collector from the save package's `SaveInfo.json` and pushed as one
envelope (`contract: "bg3-save"`, `contractVersion: 1`). The Rust collector
(`rl-collectors`, D2) and the browser WASM preview (W0) pin a copy of this
folder and MUST produce exactly the payload the reference normaliser produces.
Shared rules: [`../../README.md`](../../README.md). Story: ROK-1954.

| What | Where |
|---|---|
| Message + payload Zod (source of truth) | `packages/contract/src/companion-bg3-save.schema.ts` — `Bg3SaveMessageSchema`, `Bg3SavePayloadSchema` |
| Raw `SaveInfo.json` input (not wire) | `packages/contract/src/companion-bg3-save-raw.schema.ts` — `Bg3SaveInfoRawSchema` |
| Reference normaliser | `packages/contract/src/companion-bg3-save-normalise.ts` — `normaliseBg3SaveInfo()` |
| Display tables (not wire) | `packages/contract/src/companion-bg3-display.ts` |
| JSON Schema of one message (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Conformance + drift guard (api jest) | `api/src/companion/companion-contract.spec.ts` |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Transport

Everything in the envelope contract ([`../../envelope/v1/CONTRACT.md`](../../envelope/v1/CONTRACT.md))
applies: `POST /companion/v1/messages/bg3-save`, device bearer token, gzip
allowed, a global decoded-body ceiling before parse and this entry's
`maxBytes` after the envelope parses, two-stage parse, ack and
error codes, 5-minute clock rule. Registry entry: `maxBytes: 65_536`,
`blobSlots: ['thumbnail']`, `status: 'current'`.

The message is the envelope with `contract: "bg3-save"` and
`contractVersion: 1` (literals) and `payload` as below.

## 2. Payload fields (`Bg3SavePayloadSchema`, strict)

"Engine id" means a Larian id matching `BG3_ID_RE = ^[A-Za-z0-9_]{1,64}$`
(`Elf_WoodElf`, `SCL_Main_A`, `DifficultyHard`). Engine ids are **open
strings, never enums**, so an unseen level, class or patch is not a breaking
change. Every field is required; nullable fields send `null`, never omit.

| Field | Type | Source | Notes |
|---|---|---|---|
| `saveName` | display-safe string, 1–128 UTF-16 units (`COMPANION_DISPLAY_TEXT_RE`: no C0/C1 controls or line breaks, no lone surrogates, no U+2028/2029, no bidi embeddings/overrides/isolates U+202A–202E / U+2066–2069, not whitespace-only) | `"Save Name"` | User-authored free text; shown in the local preview before the first upload (spec Q2). A name the schema rejects makes the whole payload invalid — collectors MUST skip and report that save. The `schema.json` pattern uses `\p{…}` classes: validators MUST compile it in Unicode mode (JS `u`/`v` flag, Rust `regex`); a non-Unicode engine rejects every name. Fixture `unicode-save-name` is the check. |
| `savedAt` | ISO-8601 UTC `Z`, ≤ 24 chars | collector: `.lsv` file mtime | MUST NOT be after the envelope's `capturedAt`. |
| `campaignKey` | lowercase hex, `^[0-9a-f]{64}$` | collector (§3.3) | SHA-256 of the save-folder name (or GameID). **Never the raw name.** |
| `campaignKeySource` | `"save-folder"` \| `"game-id"` | collector | What `campaignKey` was hashed from (§3.3). |
| `gameVersion` | `^\d{1,4}(\.\d{1,10}){1,3}$` | `"Game Version"` | e.g. `4.1.1.7631656`. |
| `platform` | `^[A-Za-z0-9_]{1,32}$` | `"Platform"` | `Steam` is verified; other values are open. |
| `currentLevel` | engine id | `"Current Level"` | e.g. `SCL_Main_A`. |
| `difficulty` | engine id | `"Difficulty"[0]` | e.g. `DifficultyHard`. |
| `ruleset` | engine id or `null` | `"Difficulty"[1]` | `null` when the tuple has one element. |
| `party` | array of member, 1–16 (`BG3_PARTY_MAX`) | `"Active Party".Characters` | Save order. |
| `thumbnail` | WebP blob ref or `null` | collector: the in-package `<SaveName>.WebP` | `null` when the package has no WebP (§7). |

**Party member (`Bg3PartyMemberSchema`, strict)**

| Field | Type | Source |
|---|---|---|
| `origin` | engine id | `Origin` (`Generic` = a custom Tav; a summon looks like `DogFamiliar_Scratch_Summon`) |
| `race` | engine id | `Race` |
| `level` | integer 1–20 (`BG3_LEVEL_MAX`; vanilla 12 is unverified, 20 leaves room for mods) | `Level` |
| `xpLevel` | integer 0–10 000 000 (`BG3_XP_MAX`) | `"Experience Points (Current level)"` |
| `xpTotal` | integer 0–10 000 000 | `"Experience Points (Total)"` |
| `classes` | array of class, 0–12 (`BG3_CLASSES_MAX`) | `Classes` (absent ⇒ `[]`); more than one = multiclass, save order |
| `isSummon` | boolean | derived: `true` exactly when the raw `Classes` key is absent |

**Class (`Bg3ClassSchema`, strict):** `{ main: engine id, sub: engine id | null }`.

**WebP blob ref (`CompanionWebpRefSchema`, strict):** `{ sha256: 64 lowercase
hex, byteLength: 1…1 048 576, contentType: "image/webp", width: 1…4096,
height: 1…4096 }`.

## 3. Normalisation from `SaveInfo.json`

The normalisation rules **are** the contract. `normaliseBg3SaveInfo(raw, meta)`
is the executable reference: pure, synchronous, no hashing, clock, fs or Node
built-ins. Any other implementation MUST produce an equal payload for the same
input, as pinned by the golden pairs in §8.

### 3.1 Input

1. The caller strips a leading UTF-8 BOM if present and `JSON.parse`s the file.
2. The caller parses the result with `Bg3SaveInfoRawSchema`. It is `.loose()`
   at every level (Larian owns the file and adds keys on patches) and
   validates only the keys the normaliser reads: `"Active Party".Characters[]`
   (`Classes?: [{ Main, Sub? }]`, both XP keys, `Level`, `Origin`, `Race`),
   `"Current Level"`, `Difficulty` (1–4 strings), `"Game Version"`, `Platform`,
   `"Save Name"`. `Position` and `Subregion` are **not declared**: real files
   carry them, `.loose()` lets them through, and the normaliser drops them, so
   a Larian change to their shape cannot fail the parse.
3. The caller supplies `meta` — the facts the file does not hold:
   `{ savedAt, campaignKey, campaignKeySource, thumbnail }`. `campaignKey` is
   **already hashed** by the caller; the normaliser never hashes.
4. The caller validates the output with `Bg3SavePayloadSchema` (the
   normaliser does not parse).

### 3.2 Rules

| Raw | Wire | Rule |
|---|---|---|
| `"Save Name"` | `saveName` | copied |
| — | `savedAt`, `campaignKey`, `campaignKeySource`, `thumbnail` | from `meta` |
| `"Game Version"`, `Platform`, `"Current Level"` | `gameVersion`, `platform`, `currentLevel` | copied |
| `Difficulty[0]` | `difficulty` | copied |
| `Difficulty[1]` | `ruleset` | copied; `null` if absent. Entries after `[1]` are ignored. |
| `Characters[i]` | `party[i]` | save order kept |
| `Origin`, `Race`, `Level` | `origin`, `race`, `level` | copied |
| `"Experience Points (Current level)"` / `(Total)` | `xpLevel` / `xpTotal` | copied |
| `Classes[j].Main` / `.Sub` | `classes[j].main` / `.sub` | `Sub` that is `""` or absent ⇒ `null` |
| `Classes` absent | `classes: []`, `isSummon: true` | summon rule (verified on one summon; unverified for wildshapes and hirelings) |
| `Classes` present | `isSummon: false` | |
| `Classes` present but empty (`[]`) | `classes: []`, `isSummon: false` | **invalid** (refinement 3, §5). Collectors MUST skip that save and report it locally; a later reading of `[]` as a summon is a breaking change. |
| `Position`, `Subregion`, any other key | — | **dropped**, never sent |

Output key order (for byte-stable fixtures): `saveName, savedAt, campaignKey,
campaignKeySource, gameVersion, platform, currentLevel, difficulty, ruleset,
party, thumbnail`; member: `origin, race, level, xpLevel, xpTotal, classes,
isSummon`. Key order is not significant to the schema.

### 3.3 Campaign key

- `campaignKey` is a **pseudonymous** grouping key, not an anonymiser: it
  is a plain, unsalted SHA-256, so a low-entropy folder name can be recovered
  by hashing candidate names.
- `campaignKey` MUST be the lowercase hex SHA-256 of the save-folder name
  (`campaignKeySource: "save-folder"`) or, once ROK-1967 reads `meta.lsf`, of
  the save's GameID (`campaignKeySource: "game-id"`). The collector MUST hash
  the UTF-8 bytes of the folder's own name (no path) and MUST send all 64 hex
  characters. **The raw folder name is never sent**: its format is unverified
  and may embed the character name.
- The schema accepts exactly 64 lowercase hex characters (`^[0-9a-f]{64}$`,
  a full SHA-256; a later GameID key is hashed the same way). The invalid fixture `campaign-key-raw-folder` proves a
  raw name is rejected.
- **The folder name fragments campaigns across saves** (Codex review). A
  `save-folder` key is NOT a reliable campaign identity: one playthrough can
  span several save folders, so the server MUST NOT assume one key = one
  campaign. Campaign grouping is by `meta.lsf` GameID later (ROK-1967,
  `campaignKeySource: "game-id"`) or by the user's manual assignment.
  `campaignKeySource` exists so that switch never silently splits or merges
  campaigns.

## 4. Privacy

Only the fields in §2 plus the thumbnail blob leave the machine. The collector
MUST NEVER send: the raw `.lsv`, `Globals.lsf`, `StorySave.bin`, `meta.lsf`
contents other than a hashed GameID, `Position` (world coordinates), file
paths, the raw save-folder name, the OS username or a hardware id. The sample
`SaveInfo.json` holds no names or account ids. Two sent fields still carry
user-linked data: `saveName` is **user-authored free text** that may contain
personal text (shown in the local preview before upload), and `campaignKey` is
**pseudonymous, not anonymous** (an unsalted hash of the folder name, §3.3). Upload is opt-in per game, with
a local preview before the first upload and on every contract bump (spike §5).

## 5. Strict keys and refinements

Every object is **strict**: an unknown key rejects the whole message. So a
leaked `position` key on a member fails (`party-position-key`). These rules
are enforced by the Zod schema but **cannot be expressed in `schema.json`**
(its `description` lists them) — collectors MUST honour them too:

1. per member, `xpLevel ≤ xpTotal`;
2. `isSummon` ⇒ `classes` is empty;
3. not `isSummon` ⇒ `classes` has at least one entry;
4. on the message, `payload.savedAt` ≤ `capturedAt`, compared as instants
   (`…05Z` equals `…05.000Z`).

## 6. Size caps (exported constants)

| Constant | Value | Applies to |
|---|---|---|
| `COMPANION_BG3_SAVE_MAX_BYTES` | 65 536 | one decoded `bg3-save` body |
| `COMPANION_WEBP_MAX_BYTES` | 1 048 576 | one thumbnail blob (sample ≈ 41 KB) |
| `COMPANION_IMAGE_EDGE_MAX` | 4096 | thumbnail `width` / `height` |
| `BG3_PARTY_MAX` / `BG3_CLASSES_MAX` | 16 / 12 | `party`, `classes` |
| `BG3_SAVE_NAME_MAX_CHARS` | 128 | `saveName` |

The body cap is ≥ the largest schema-valid message (every array full, every
string at max length; ≈ 33 KB: engine ids are ASCII, and `saveName` adds
< 1 KB in the worst case), so the array and string caps bind first. The reader
checks this cap after the envelope parses; the global pre-parse ceiling is
`COMPANION_MESSAGE_MAX_BYTES` (envelope `CONTRACT.md` §1).
`src/__tests__/companion-bg3-save-largest-message.spec.ts` builds that message
and fails CI if it stops fitting — recompute the cap when an array or string
cap grows.

## 7. Thumbnail blob

- The collector uploads the in-package `<SaveName>.WebP` bytes with
  `PUT /companion/v1/blobs/:sha256` (C3), in either order relative to the
  message, and references it from `payload.thumbnail`.
- The server MUST check the hash and length, and read the VP8/VP8L/VP8X header
  width/height and reject the blob unless they equal the ref's `width` and
  `height`, **before** decoding any pixels. It re-encodes accepted thumbnails
  with `sharp` before serving them.

## 8. Fixtures

- `fixtures/saveinfo/<case>.saveinfo.json` — anonymised raw `SaveInfo.json`
  input. `fixtures/<case>.json` — the full message built from it with
  `normaliseBg3SaveInfo` and synthetic meta. Each pair is golden: the
  normaliser output MUST equal the message payload, and the message MUST parse.
  Cases: `act2-party-4p-summon` (from the operator's save, transform below),
  `act1-solo-no-thumbnail` (synthetic, `thumbnail: null`,
  `campaignKeySource: "game-id"`), `ruleset-null` (synthetic, one-element
  `Difficulty`).
- `fixtures/invalid/<name>.json` — MUST be rejected; `fixtures/invalid/EXPECTED.json`
  maps each name to the `{ path, code }` of the Zod issue it must raise (path
  joined with `.`, `""` = root).
- `fixtures/placeholder-thumbnail.webp` — a **synthetic** flat mid-grey
  1280×720 WebP. The golden thumbnail ref (sha256, byteLength, 1280, 720)
  matches these bytes.

**Anonymisation (operator ruling 5).** Fixtures are anonymised JSON plus a
placeholder image — **never the real screenshot**. The transform applied to
the operator's raw `SaveInfo.json`, verbatim:

1. Strip a leading UTF-8 BOM if present.
2. For every `"Active Party".Characters[i]`, set `"Position"` → `[0, 0, 0]`.
   Keep the key so the raw fixture still shows Larian's real shape; the
   normaliser drops it.
3. Set `"Save Name"` → `"QuickSave_1"`.
4. Keep every other key and value **unchanged**: `Classes`, both XP keys,
   `Level`, `Origin`, `Race`, `Subregion`, `Current Level`, `Difficulty`,
   `Game Version`, `Platform`.
5. Add nothing from outside the file: no mtime, folder name, `meta.lsf`,
   `Globals.lsf` or WebP data.
6. Write the file with a 2-space indent, the source key order and a trailing
   newline.

The placeholder image was generated once with the api's `sharp`:

```js
sharp({create:{width:1280,height:720,channels:3,background:'#808080'}}).webp({quality:50})
```

All meta values are synthetic (`campaignKey: "0123…cdef"`,
`savedAt: "2026-10-24T12:00:00Z"`, `capturedAt: "2026-10-24T12:00:05Z"`).
Regenerate, from the repo root:

```
npm run build -w packages/contract && node packages/contract/scripts/gen-companion-fixtures.mjs
node packages/contract/scripts/gen-companion-schemas.mjs
```

## 9. Versioning

- The contract version is `contractVersion` (`BG3_SAVE_CONTRACT_VERSION`).
- **Stays v1 (additive):** a new **optional** field the server can ignore
  (server ships first; for example `subregion` if it is ever seen non-empty),
  or relaxing a refinement or range.
- **Requires v2 (breaking):** renaming or removing a field, making an optional
  field required, changing a type, range or normalisation rule, tightening a
  refinement, or turning an open id into an enum. v2 lives in
  `companion/bg3-save/v2/` with its own schema, fixtures and changelog and a
  new registry entry; `v1/` is frozen from then on.
- **Transition:** the server accepts the current **and** the previous version
  (registry status `accepted`) until the operator confirms the app has shipped
  the new one; the old one then becomes `retired`.

## 10. Change process

1. A Raid Ledger PR touching this folder is the only way to change the format.
   It updates the Zod source and the normaliser, regenerates `schema.json` and
   the fixtures, adds a `CHANGELOG.md` entry, and its PR body says
   **additive** or **breaking**.
2. `rl-collectors` and the Companion app request a change through a Raid
   Ledger story; they never change the format on their own.

## 11. Display tables are not wire

`BG3_LEVEL_DISPLAY`, `BG3_DIFFICULTY_DISPLAY`, `BG3_RULESET_DISPLAY`,
`bg3LevelDisplay()` and `bg3DifficultyDisplay()` turn engine ids into labels
for the web and api. They are absent from `schema.json`; editing them needs no
version bump and no `CHANGELOG.md` entry. An id they do not list falls back to
the raw id (`known: false`). They ship only ids seen in a real save; recalled
labels (and `DifficultyHard` → "Tactician", spec Q1) are unverified.
