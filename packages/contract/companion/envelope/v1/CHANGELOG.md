# Raid Ledger Companion envelope — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v1 — 2026-10-25 (additive) — initial contract

- **Additive.** New folder `packages/contract/companion/envelope/v1/` (ROK-1954).
  No existing contract changes: `ledgerlink/` and `valheim-link/` are untouched.
- Envelope `{ envelopeVersion: 1, contract, contractVersion, capturedAt,
  appVersion, collectorVersion, payload }`, strict. `contract` is an open id
  string resolved through the registry (`COMPANION_CONTRACTS`), so an unknown
  id is `unknown_contract`, not a parse error.
- Ack `{ status: "accepted" | "stale" }` and the nine ingest error codes
  (`invalid_envelope`, `unknown_contract`, `unknown_contract_version`,
  `retired_contract_version`, `invalid_payload`, `payload_too_large`,
  `captured_at_in_future`, `unauthorized`, `rate_limited`).
- Global pre-parse body ceiling `COMPANION_MESSAGE_MAX_BYTES` (262 144), then
  the registry entry's `maxBytes` after the envelope parses.
- `envelopeVersion` is an addition to the spike's six-key envelope (spec Q5).
- First registry entry: `bg3-save` v1 (`../../bg3-save/v1/`).
