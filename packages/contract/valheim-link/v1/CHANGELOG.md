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
  6 valid, 9 invalid.
