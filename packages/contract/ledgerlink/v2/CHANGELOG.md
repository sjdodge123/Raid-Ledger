# LedgerLink wire contract v2 — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v2 — 2026-11-15 — new `!RL2!` envelope + `loot` history section — **breaking**

- New envelope: header `!RL2!<section>…` **and** payload `schema: 2` on every
  section (ROK-2184). The `char` / `guild` / `raid` payloads are byte-identical
  in shape to v1 apart from `schema: 2`.
- New section `loot` (never paged): `data = { windowStart, windowEnd,
  minQuality, drops[] ≤ 500 }`, each drop `{ at, itemId, link?, quantity,
  quality?, looterName, looterGuid?, method, instanceId?, difficultyId?,
  encounterId?, encounterName? }`, all `.strict()`. History only — no DKP,
  points or roll values.
- Mixed paste: at most one `loot` token; max tokens 10 → 11. **One version per
  paste** — a paste mixing `!RL1!` and `!RL2!` is rejected with
  `UNSUPPORTED_VERSION`. No new error code.
- **No `bank` section** (operator ruling Q1, 2026-11-15): a guild bank on WoW:
  Forever could not be verified; a bank, if ever, is v3.
- **Transition:** the server accepts **v1 and v2** side by side. v1 is dropped
  only after LedgerLink ships v2 + ≥ 90 days + 30 consecutive days with no
  accepted `!RL1!` import (ruling Q7). `v1/` is frozen from this entry on.
- An old v1-only server answers `UNSUPPORTED_VERSION` for `!RL2!char/guild/raid`
  and `BAD_HEADER` for `!RL2!loot`: **LedgerLink must not emit `!RL2!` until
  Raid Ledger confirms a v2 server is deployed.**
- Generated `schema.json` (from `AddonExportV2Schema`); golden fixtures = the
  v2 twin of every valid v1 fixture plus `loot`, `loot-empty-window`,
  `mixed-char-guild3-raid-loot` and ten invalid cases (CONTRACT §8).
