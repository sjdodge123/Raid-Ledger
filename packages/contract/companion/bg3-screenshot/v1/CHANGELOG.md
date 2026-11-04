# Raid Ledger Companion `bg3-screenshot` — changelog

Newest first. Every entry states **additive** or **breaking** (see
`../../README.md` rule 3). Only a Raid Ledger PR may add an entry.

## v1 — 2026-11-03 (additive) — initial contract

- **Additive.** New folder `packages/contract/companion/bg3-screenshot/v1/` and
  registry entry `bg3-screenshot` v1 (ROK-1966): `maxBytes: 4_096`,
  `blobSlots: ['image']`. No existing contract changes.
- Payload: `takenAt`, `width`, `height` (original capture), `image` (WebP blob
  ref ≤ 1 MiB, edges ≤ 4096) and `target.hubGuildId`. Every object is strict;
  three refinements (CONTRACT §4).
- Companion ingest API, also additive: the `/config` contract entry gains an
  optional `hubTargets` list (`{ hubGuildId, name, isDefault }`), and its
  `blobSlots` enum gains `"image"`. Shared primitive `CompanionHubGuildIdSchema`.
- Fixtures: synthetic only (two valid, fourteen invalid).
