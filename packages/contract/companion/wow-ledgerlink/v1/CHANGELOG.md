# Raid Ledger Companion `wow-ledgerlink` — changelog

Newest first. Every entry states **additive** or **breaking** (see the shared
`../../README.md` → Rules §3). Only a Raid Ledger PR may add an entry.

## v1 — 2026-10-28 (additive) — initial contract

- **Additive.** New folder `packages/contract/companion/wow-ledgerlink/v1/`
  and registry entry `wow-ledgerlink` v1 (ROK-1964). No existing contract
  changes: the LedgerLink v1 export format (`packages/contract/ledgerlink/v1/`),
  `bg3-save`, the envelope and `device-link` are untouched.
- Payload: `{ exportString }` — one unchanged LedgerLink v1 export string,
  1–260 096 chars (`COMPANION_WOW_LEDGERLINK_EXPORT_MAX`, 256 KiB − 2 KiB so
  the envelope fits the 262 144-byte global ceiling). Strict keys.
- Registry: `maxBytes: 262_144`, `blobSlots: []`, `status: 'current'`.
- Fixtures wrap the anonymised LedgerLink v1 golden strings verbatim; the
  2000-member 8-page guild export is 21 127 chars (8.1 % of the cap).
