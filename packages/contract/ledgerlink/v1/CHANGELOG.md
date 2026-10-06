# LedgerLink wire contract — changelog

Newest first. Every entry states **additive** or **breaking** (see
`CONTRACT.md` → Versioning). Only a Raid Ledger PR may add an entry.

## v1 — 2026-10-05 — mixed paste ("Export all") — **additive**

- **Additive (stays v1).** One paste may now carry one `char`, one `guild`
  export (unpaged or every page once) and one `raid` string together, any
  order (ROK-1737, CONTRACT.md §5.1). Token grammar, envelope and every
  payload unchanged; a single-section paste decodes exactly as before
  (same result, same per-section sha256). The addon may adopt it at will.
- New constants: `ADDON_IMPORT_MAX_TOKENS = 10` (whole paste),
  `ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS = 600`. `ADDON_IMPORT_MAX_PAGES`
  stays 8 and now applies to one guild export's pages only.
- Mixed paste is all-or-nothing; every section must share `who.guid`,
  `client.region`, the realm-less exporter name, and an `exportedAt` within
  600 s (`INVALID_PAYLOAD`); a duplicate section → `PAGES_INCOMPLETE`. The
  character binding runs against every section. Still additive: these rules
  only reject pastes that were rejected entirely before ROK-1737.
- Fixtures: valid `.json` for a mixed paste is `{ sections: [...] }`
  (CONTRACT.md §8). New valid: `mixed-char-raid`,
  `mixed-char-guild3-raid-shuffled`; new invalid: `mixed-two-char`,
  `mixed-guild-incomplete`, `mixed-different-exporters`,
  `mixed-different-region`, `mixed-11-tokens`.
  Every existing fixture unchanged byte-for-byte. `schema.json` unchanged.

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

- 2026-10-05 v1 — fixture fix, additive: guild fixtures now include the exporter; wire format unchanged.
