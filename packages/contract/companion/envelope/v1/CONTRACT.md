# Raid Ledger Companion ↔ Raid Ledger envelope — v1

**Owner: Raid Ledger.** Every message the Companion app sends is one envelope.
The envelope carries a contract id and version; the payload is defined by that
contract's own folder (index: [`../../README.md`](../../README.md)). Shared rules
(strict keys, server ships first, additive vs breaking, anonymised fixtures)
are in the README. Story: ROK-1954.

| What | Where |
|---|---|
| Zod source of truth | `packages/contract/src/companion-common.schema.ts`, `packages/contract/src/companion-envelope.schema.ts` — `CompanionEnvelopeSchema` |
| Registry (contract id → version → spec) | `packages/contract/src/companion-registry.ts` — `COMPANION_CONTRACTS`, `lookupCompanionContract()` |
| JSON Schema of the envelope (generated) | [`schema.json`](./schema.json) |
| Golden fixtures | [`fixtures/`](./fixtures) |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Conformance + drift guard (api jest) | `api/src/companion/companion-contract.spec.ts` |

If this prose and the Zod source ever disagree, **the Zod source wins** and
this file is the bug.

## 1. Transport

The endpoint is ROK C3 and the device token is ROK C2; this section is what the
app may rely on.

- `POST /companion/v1/messages/:contract`, one message per request,
  `Content-Type: application/json`, UTF-8. `:contract` MUST equal the body's
  `contract`.
- `Authorization: Bearer rlcd_…` — a per-user, ingest-only device token (C2).
  It is never logged.
- The body MAY be sent with `Content-Encoding: gzip`. The size cap is the
  registry entry's `maxBytes` and applies to the **decoded** JSON. The server
  inflates with that cap as its output limit and rejects a larger body
  (`payload_too_large`) **before** any JSON parse, so a gzip body can never
  expand past it.
- Blobs (images) are never inside the JSON. A payload references a blob by
  `{ sha256, byteLength, contentType, width, height }` and the app uploads the
  bytes separately (`PUT /companion/v1/blobs/:sha256`, C3). The message and its
  blob may arrive in either order. Each contract lists its blob slots
  (`blobSlots` in the registry) and the image checks in its own `CONTRACT.md`.

## 2. Fields

| Field | Type | Req | Meaning |
|---|---|---|---|
| `envelopeVersion` | `1` (literal, `COMPANION_ENVELOPE_VERSION`) | yes | Envelope version. Offline-queued messages outlive app updates, so each one describes itself. |
| `contract` | string `^[a-z][a-z0-9-]{1,39}$` | yes | Registry contract id, e.g. `bg3-save`. **Open string**: an unknown id parses here and is a registry miss (§3), never a parse error. |
| `contractVersion` | integer `1…999` (`COMPANION_CONTRACT_VERSION_MAX`) | yes | Version of `contract`. |
| `capturedAt` | ISO-8601 UTC with a `Z` offset (`2026-10-24T12:00:05Z`), at most millisecond precision (≤ 24 chars, `COMPANION_TIMESTAMP_MAX_CHARS`) | yes | When the collector built the message. Not later than server time + 5 min (§5). |
| `appVersion` | `MAJOR.MINOR.PATCH` (each 1–4 digits) with an optional `-` pre-release of 1–32 `[0-9A-Za-z.-]` chars, e.g. `1.2.3-beta.1` | yes | Companion app version, compared to `/companion/v1/config` `minAppVersion`. No `+build` metadata (unlike Valheim). |
| `collectorVersion` | same format as `appVersion` | yes | Collector build version, for parser-bug triage. |
| `payload` | any JSON value | yes | Opaque at this stage; parsed by the contract's message schema (§3). The key MUST be present. |

The envelope is strict: any other top-level key rejects the message
(`invalid_envelope`).

## 3. Two-stage parse and registry lookup

1. The server parses the body with `CompanionEnvelopeSchema`. A failure is
   `invalid_envelope`.
2. It calls `lookupCompanionContract(contract, contractVersion)`, which reads
   **own keys only** (so `__proto__` or `constructor` is `unknown_contract`):

   | Lookup result | Meaning | Error code |
   |---|---|---|
   | `{ kind: 'ok', spec }` | The version has status `current` or `accepted`. | — |
   | `{ kind: 'unknown_contract' }` | No such contract id. | `unknown_contract` |
   | `{ kind: 'unknown_contract_version', current }` | The id is known but this version is not listed (higher **or** lower than any listed). | `unknown_contract_version` |
   | `{ kind: 'retired', current }` | The version is listed with status `retired`. | `retired_contract_version` |

   `current` is the highest version with status `current`, else the highest
   listed version; the app SHOULD tell the user to update to it.
3. The server parses the **whole body** (envelope included) with `spec.schema`,
   the contract's full-message schema, which narrows `contract` and
   `contractVersion` to literals and makes `payload` strict. A failure is
   `invalid_payload`.

## 4. Ack and error codes

A success body is `{ "status": "accepted" | "stale" }` (`CompanionIngestAckSchema`,
strict). `stale` means the message is older than the snapshot already stored
for the same key; it is not an error and the app MUST NOT retry it.

An error carries one `code` (`CompanionIngestErrorCodeSchema`). **The code
strings are wire** — the app pins them, and a new code is additive. The HTTP
status is the endpoint's call (C3); the suggested mapping is below.

| Code | Cause | Suggested HTTP |
|---|---|---|
| `invalid_envelope` | Body not an object, an envelope key missing, wrong type, `envelopeVersion ≠ 1`, or an unknown top-level key | 400 |
| `unknown_contract` | `contract` not in the registry | 404 |
| `unknown_contract_version` | Known contract, version not listed | 404 |
| `retired_contract_version` | Version listed as `retired` | 409 |
| `invalid_payload` | The contract's message schema fails (extra key, type, range, refinement) | 400 |
| `payload_too_large` | Decoded body larger than the entry's `maxBytes` (enforced by the reader, not Zod) | 413 |
| `captured_at_in_future` | `capturedAt` more than 5 min past the server clock (§5) | 400 |
| `unauthorized` | Missing, unknown or revoked device token | 401 |
| `rate_limited` | Per-token rate limit hit | 429 |

The app SHOULD treat every 4xx other than 408 and 429 as terminal for that
message and surface it; it SHOULD re-link the device on 401.

## 5. Clock rule

The server **rejects** (`captured_at_in_future`) a message whose `capturedAt`
is more than 5 minutes (`COMPANION_CAPTURED_AT_MAX_FUTURE_MS = 300_000`) past
its own clock, so a bad client clock cannot pin a snapshot as "latest" forever.
Zod has no clock, so this check is the endpoint's (C3), not the schema's.

## 6. Fixtures

- `fixtures/bg3-save.json` — a copy of the `bg3-save` v1 golden message
  (`../../bg3-save/v1/fixtures/act2-party-4p-summon.json`). It MUST parse as an
  envelope.
- `fixtures/unknown-contract.json` — `contract: "minecraft-world"`. It MUST
  parse as an envelope, and `lookupCompanionContract` MUST return
  `unknown_contract`.
- `fixtures/invalid/<name>.json` — MUST be rejected by `CompanionEnvelopeSchema`
  (`envelope-version-2`, `contract-id-uppercase`, `missing-payload`,
  `unknown-key`, `app-version-not-semver`). `fixtures/invalid/EXPECTED.json`
  maps each name to the `{ path, code }` of the Zod issue it must raise (path
  joined with `.`, `""` = root).

All values are synthetic. The api spec `api/src/companion/companion-contract.spec.ts`
checks every fixture and the `schema.json` drift guard.

## 7. Versioning

- The envelope version is `envelopeVersion`; each contract versions
  independently through `contractVersion`.
- **Stays v1 (additive):** a new **optional** envelope field the server can
  ignore (server ships first), or a new error code.
- **Requires v2 (breaking):** renaming or removing a field, making an optional
  field required, changing a type or format, or changing the transport. v2
  lives in `companion/envelope/v2/` with its own schema, fixtures and
  changelog; `v1/` is frozen from then on.
- **Transition:** the server accepts the current **and** the previous envelope
  version until the operator confirms the app has shipped the new one.

## 8. Change process

1. A Raid Ledger PR touching this folder is the only way to change the
   envelope. It updates the Zod source, regenerates `schema.json`
   (`npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs`)
   and the fixtures, adds a `CHANGELOG.md` entry, and its PR body says
   **additive** or **breaking**.
2. The Companion app requests a change through a Raid Ledger story; it never
   changes the format on its own.
