# LedgerLink wire contract — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v1 — 2026-10-05 (initial)

- **Breaking (new contract).** First formal, versioned contract between Raid
  Ledger and the LedgerLink addon (ROK-1724; operator ruling 2026-10-05:
  Raid Ledger owns the format, LedgerLink conforms).
- Envelope `!RL1!<section>[-<n>of<m>]!<base64(zlib(json))>`, sections
  `char` / `guild` / `raid`; guild paging up to 8 pages / 2000 members.
- Payload `schema: 1`; every object strict (unknown key rejects the string;
  no `officerNote`); `client.region` numeric 1–5; ruleset spelled
  `roleplaying`.
- `schema.json` generated from `AddonExportSchema`; golden fixtures: 7 valid,
  9 invalid.
