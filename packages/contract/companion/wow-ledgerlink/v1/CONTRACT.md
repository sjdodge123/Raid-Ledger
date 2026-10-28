# Raid Ledger Companion `wow-ledgerlink` wire contract — v1

**Owner: Raid Ledger.** One LedgerLink export run, read by the Companion from
the LedgerLink addon's SavedVariables outbox (`LedgerLinkDB.outbox[guid]`) and
pushed as one envelope (`contract: "wow-ledgerlink"`, `contractVersion: 1`).
The payload **wraps the unchanged LedgerLink v1 export string** — the same
text a user pastes into Raid Ledger. The Companion collector pins a copy of
this folder. Shared rules: [`../../README.md`](../../README.md). Story:
ROK-1964.

| What | Where |
|---|---|
| Message + payload Zod (source of truth) | `packages/contract/src/companion-wow-ledgerlink.schema.ts` — `WowLedgerlinkMessageSchema`, `WowLedgerlinkPayloadSchema` |
| The wrapped export format (NOT changed by this contract) | [`../../../ledgerlink/v1/CONTRACT.md`](../../../ledgerlink/v1/CONTRACT.md) |
| JSON Schema of one message (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Conformance + drift guard (api jest) | `api/src/companion/companion-contract.spec.ts` |
| Unit spec (schema, cap, registry) | `packages/contract/src/__tests__/companion-wow-ledgerlink.schema.spec.ts` |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Transport

Everything in the envelope contract ([`../../envelope/v1/CONTRACT.md`](../../envelope/v1/CONTRACT.md))
applies: `POST /companion/v1/messages/wow-ledgerlink`, device bearer token,
gzip allowed, the global decoded-body ceiling before parse and this entry's
`maxBytes` after the envelope parses, two-stage parse, ack and error codes,
5-minute clock rule. Registry entry: `maxBytes: 262_144`
(`COMPANION_WOW_LEDGERLINK_MAX_BYTES` = `COMPANION_MESSAGE_MAX_BYTES`),
`blobSlots: []`, `status: 'current'`.

The message is the envelope with `contract: "wow-ledgerlink"` and
`contractVersion: 1` (literals) and `payload` as below.

## 2. Payload (`WowLedgerlinkPayloadSchema`, strict)

| Field | Type | Notes |
|---|---|---|
| `exportString` | string, 1–260 096 UTF-16 units (`COMPANION_WOW_LEDGERLINK_EXPORT_MAX`) | One LedgerLink v1 export run, **byte-for-byte as the addon wrote it**: one or more `!RL1!…` tokens separated by newlines (a character, a guild page-set, a raid — the same mix a paste allows). The collector MUST NOT trim, re-wrap, re-encode or split it. |

This contract checks only the length and the strict keys. The inner format
(token headers, base64, zlib, the decoded JSON, page sets, the 600-second
same-export window, same exporter) is checked by the server's LedgerLink
decoder, exactly as for a paste — a string the decoder rejects is a terminal
`invalid_payload`. One outbox entry = one message (spec D4), so one bad
entry never blocks the others.

### 2.1 Import outcomes

The server applies the export as the device's user with no preview (spec D2:
`dryRun: false`, no confirm). An applied, unchanged (same export again) or
stale (older than what is stored) import all ack `202 { "status": "accepted" }`.
A rejected import writes nothing and answers with fixed copy plus **one**
`issues` entry `{ "path": "payload.exportString", "code": <LedgerLink import
code> }` — the code (`BAD_HEADER`, `RULESET_REQUIRED`, `ROSTER_HELD`, …),
never the import's message text or the string:

| Status | `code` | Retry? | When |
|---|---|---|---|
| 400 | `invalid_payload` | no (terminal) | every import reject except the two below |
| 429 | `rate_limited` | yes, later | the user's import rate limit (`RATE_LIMITED`) |
| 413 | `payload_too_large` | no | the decoded export is over the import limit (`TOO_LARGE`) |

A **new** character is created automatically when its export carries a
ruleset, or when its realm is in the admin realm→ruleset map. A **Hardcore**
mapping is never used as that fallback: a Hardcore character without a
ruleset in its export is rejected with `RULESET_REQUIRED`. Creating a
Hardcore character is refused on every import path today, paste included
(ruling A1, `assertCreatable`), until that ruling is lifted. Uploads for a
Hardcore character that already exists update it as normal.

## 3. Size cap (spec D3)

| Constant | Value | Applies to |
|---|---|---|
| `COMPANION_WOW_LEDGERLINK_EXPORT_MAX` | 260 096 (256 KiB − 2 KiB) | `payload.exportString` |
| `COMPANION_WOW_LEDGERLINK_MAX_BYTES` | 262 144 | one decoded message body |

A paste may be up to `ADDON_IMPORT_MAX_BYTES` (262 144), but a string that
long cannot fit inside an envelope under the 262 144 global ceiling, so the
companion cap is 2 KiB lower. LedgerLink strings are ASCII (base64 plus `!`,
`-`, digits and newlines), so the largest valid message — a 260 096-char
string with every envelope field at its maximum length — is **260 367 bytes**
of compact JSON, under `maxBytes` (the unit spec builds it). Each newline
JSON-escapes to two bytes; a real export has at most a handful.

**Measured fixture sizes** (`exportString` length / compact message bytes):

| Fixture | `exportString` | Message |
|---|---|---|
| `char-normal` | 614 | 797 |
| `guild-3-pages` | 6 646 | 6 831 |
| `mixed-char-guild3-raid-shuffled` | 7 776 | 7 963 |
| `guild-8-pages-2000-members` | **21 127** | 21 317 |

The 2000-member, 8-page guild export (LedgerLink's own worst-case roster
fixture) uses **8.1 %** of the cap. A real Forever guild is far smaller.

## 4. Privacy

Only the export string the addon already shows the user (and the user could
paste) leaves the machine. The collector MUST NOT send the rest of
`LedgerLink.lua`, file paths, the WoW account folder name, the OS username or
a hardware id. The string itself carries character, guild and raid data as
documented in the LedgerLink contract; upload is opt-in in the Companion.

## 5. Strict keys

Every object is **strict**: an unknown key on the envelope or the payload
rejects the whole message (`envelope-unknown-key`, `payload-unknown-key`).
There are no cross-field refinements; `schema.json` expresses every rule.

## 6. Fixtures

Generated — never edit by hand:

```
npm run build -w packages/contract && node packages/contract/scripts/gen-companion-wow-ledgerlink-fixtures.mjs
```

- `fixtures/<case>.json` — a full message whose `exportString` is
  `packages/contract/ledgerlink/v1/fixtures/<case>.txt` **verbatim** (those
  strings are already anonymised under the LedgerLink contract; no real names,
  GUIDs or guild names). Envelope meta (`capturedAt`, versions) is synthetic.
  The api spec asserts each wraps its LedgerLink fixture byte-for-byte.
- `fixtures/invalid/<case>.json` + `EXPECTED.json` — each case and the Zod
  issue `{ path, code }` it must raise: `envelope-unknown-key`,
  `payload-unknown-key`, `export-missing`, `export-empty`, `export-over-cap`
  (260 097 × `A`), `export-not-string`, `contract-version-2`,
  `contract-bg3-save`.

## 7. Versioning

Same rules as the shared README §3. The wrapped LedgerLink format has its own
version (`!RL1!`, `packages/contract/ledgerlink/v1/`); a LedgerLink `v2`
string would be decoded by the server's LedgerLink decoder, not by a new
version of this contract, unless the payload shape itself changes. Raising or
lowering the cap is **breaking** for a lower cap and additive for a higher one
that still fits the global ceiling.

## 8. Change process

Only a Raid Ledger PR touching this folder changes the format. It updates the
Zod source, regenerates `schema.json` and the fixtures, adds a `CHANGELOG.md`
entry and says **additive** or **breaking** in its body. The Companion
requests changes through a Raid Ledger story.
