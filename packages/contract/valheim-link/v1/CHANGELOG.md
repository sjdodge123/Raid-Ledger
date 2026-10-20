# RL Valheim Link wire contract — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v1 — 2026-10-20 (additive) — `recipes`

- **Additive.** New message `kind: "recipes"` (ROK-1854): crafting recipes,
  build pieces, crafting stations and processing steps (smelter, kiln,
  windmill, spinning wheel, refinery, fermenter, cooking, obliterator),
  exported by an admin client once per (game version, mod set), keyed
  (`serverId`, `gameVersion`), latest `capturedAt` wins. Requirements carry
  the **raw** fields (`amount`, `amountPerLevel`,
  `extraAmountOnlyOneIngredient`, `recover`); Raid Ledger computes the
  per-quality cost with the formula in CONTRACT §5b, and `formula: "custom"`
  flags recipes whose live values differ. Valheim 1.0.20 fields are optional:
  `stations[].upgrader`, `resources[].upgraderResource`. Piece and station
  icons are atlas-only, from a separately uploaded `atlas`. Caps: 4 096
  recipes, 4 096 pieces, 256 stations, 256 processors, 2 048 processes, 16
  requirements per recipe/piece, 8 inputs per process, 12 000 requirement
  entries in total; body cap `VALHEIM_LINK_RECIPES_MAX_BYTES` 12 MiB (largest
  schema-valid ≈ 10.33 MB, pinned by the largest-message spec); gzip
  optional. A new value in the closed `kind` enum is additive under §9: the
  server ships first. `schema.json` regenerated; fixtures `recipes-vanilla`,
  `recipes-processing` and 12 invalid.


## v1 — 2026-10-20 (additive)

- **Additive.** `VALHEIM_LINK_ITEMS_MAX_BYTES` is raised from 10 MiB to
  **12 MiB** (12 582 912). The largest schema-valid `items` message grew to
  ≈ 11.05 MB when the optional file-icon `blob` landed (2026-10-18), above the
  old cap — a relaxation the server accepts, so v1 stays. `schema.json`
  unchanged (the caps are not part of the JSON schema). CONTRACT.md §7 now
  carries the measured largest message per kind (character ≈ 1.87 MB, map
  ≈ 7.03 MB, items ≈ 11.05 MB), and a contract test builds each one from the
  schema limits and fails CI when it stops fitting (ROK-1855). Pin this
  revision in the mod; the reverse proxy body cap is tracked by ROK-1850.

## v1 — 2026-10-18 (additive)

- **Additive.** A `file` item icon may carry an optional `blob` — a binary
  ref (`sha256`, `byteLength`, `contentType`, `width`, `height`; the same
  `ValheimBinaryRefSchema` as `baseMap` and `atlas`) — so its PNG uploads
  through the content-addressed blob route (CONTRACT.md §1). The upload is
  capped by `VALHEIM_LINK_BINARY_MAX_BYTES` (16 MiB, §7). Without `blob` the
  message stays valid and the server leaves that icon unresolved (ROK-1833,
  spec Q14). `schema.json` regenerated; `items-file-icons` now has one icon
  with `blob` and one without; invalid fixture
  `items-file-icon-blob-bad-sha` (29 in all).

## v1 — 2026-10-17 (initial)

- **Breaking (new contract).** First formal, versioned contract between Raid
  Ledger and the RL Valheim Link mod (ROK-1829, child of ROK-1799; operator
  rulings 2026-10-15: the mod pushes, Raid Ledger never reads server files,
  Raid Ledger owns the format).
- JSON push, one message per request, per-server bearer token;
  `schemaVersion: 1`, `kind` discriminator: `character` (identity,
  equipment, explicit-size inventory grid with mod rows, skills, trophies,
  known items/recipes), `map` (gzip+base64 LSB-first explored bitsets,
  optional shared cartography layer, pins, base-map PNG reference) and
  `items` (prefab → name, category, icon from an atlas or per-file PNG).
- Map grid constants (2048 px, 12 m/px, origin centre) are carried in the
  message and are UNVERIFIED against the game build.
- `schema.json` generated from `ValheimLinkMessageSchema`; golden fixtures:
  6 valid, 19 invalid.
- Pre-release hardening (review round, still v1 — nothing shipped yet):
  bitmap `data` must be one gzip member (`H4sI…`), 28 chars minimum, a
  multiple of 4, within `valheimLinkBitmapMaxGzipBytes(w, h)`, checked with
  a stack-safe single-class regex; the server MUST gunzip with
  `maxOutputLength = valheimLinkBitmapBytes(w, h)` and reject any other
  length (CONTRACT.md §6). int64 ids canonical and inside the signed 64-bit
  range; SteamID64 = 17 digits ≥ the individual-account base (no fixed
  prefix). `capturedAt` ≤ 3 fractional digits, rejected when > 5 min in the
  future. `baseMap` must be `grid.textureSize` square, and the server checks
  the PNG `IHDR`. `extraRows` lists exactly the rows past the vanilla four.
  Latest-wins keys include `serverId`. Body caps raised to cover the largest
  schema-valid message: `character` 2 MiB, `items` 10 MiB (`map` unchanged at
  8 MiB).
- Second review round (still v1, unreleased): an int64 / SteamID64 that is
  not a canonical decimal (`abc`, `1e5`, a 40-digit string, a negative
  SteamID64, `-0`) is now **rejected** (`invalid_format`) instead of
  throwing out of `safeParse` — the regex aborts before the range check,
  which re-checks the pattern itself (8 new invalid fixtures; 27 in all).
  The server bitmap rule (CONTRACT.md §6 step 4) now also requires **one**
  gzip member with `FLG = 0`, rejecting concatenated members that Node's
  gunzip would join. `schema.json` unchanged.
- `modVersion` is checked as SemVer 2.0.0 (build metadata allowed, leading
  zeros rejected), ≤ 64 chars; `schema.json` regenerated; invalid fixture
  `mod-version-not-semver` (28 in all).
