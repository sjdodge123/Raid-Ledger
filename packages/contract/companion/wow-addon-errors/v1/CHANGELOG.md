# Raid Ledger Companion `wow-addon-errors` — changelog

Newest first. Every entry states **additive** or **breaking** (see the shared
`../../README.md` → Rules §3). Only a Raid Ledger PR may add an entry.

## v1 — 2026-11-19 (additive) — initial contract

- **Additive.** New folder `packages/contract/companion/wow-addon-errors/v1/`
  and registry entry `wow-addon-errors` v1 (ROK-2099). No existing contract
  changes.
- Payload: `{ source: "buggrabber", sourceVersion, accountKey, characterHint?,
  wowFlavor?, records[1..50] }`; record `{ addon, message, stack?,
  firstSeenAt, lastSeenAt, count, session? }`. Strict keys everywhere; no
  `locals` field.
- Refuses an unscrubbed home-folder or drive-letter path in `addon`,
  `message`, `stack` and `sourceVersion` (`not.pattern` in `schema.json`).
- Registry: `maxBytes: 262_144`, `blobSlots: []`, `status: 'current'`.
