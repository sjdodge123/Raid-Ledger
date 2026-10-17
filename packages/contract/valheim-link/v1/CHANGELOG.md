# RL Valheim Link wire contract — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

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
