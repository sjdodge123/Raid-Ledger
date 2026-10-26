# Raid Ledger Companion ↔ Raid Ledger device link — v1

**Owner: Raid Ledger.** How the Companion app gets, uses and loses its device
token: an RFC 8628-style device authorization grant (start → the user approves
on the web → the app polls), plus the app's token self-check. This is an HTTP
surface, not an envelope message, so it has **no registry entry**. Story:
ROK-1955.

| What | Where |
|---|---|
| Zod source of truth | `packages/contract/src/companion-devices.schema.ts` |
| JSON Schema (generated, one `$defs` entry per body) | [`schema.json`](./schema.json) — `node packages/contract/scripts/gen-companion-device-link-schema.mjs` after a contract build |
| Golden fixtures | [`fixtures/`](./fixtures) (valid) and [`fixtures/invalid/`](./fixtures/invalid) + `EXPECTED.json` |
| Changelog | [`CHANGELOG.md`](./CHANGELOG.md) |
| Drift guard + fixture conformance (contract vitest) | `packages/contract/src/__tests__/companion-device-link-contract.spec.ts` |
| Server behaviour | `api/src/companion/devices/` |

If this prose and the Zod source ever disagree, **the Zod source wins** and this
file is the bug. Validate a body against `schema.json#/$defs/<name>`; the root
schema rejects everything on purpose (`"not": {}`).

## 1. Conventions

- JSON over HTTPS, `Content-Type: application/json`, UTF-8. Field names are
  **camelCase** (`deviceCode`, `expiresIn`), not RFC 8628's snake_case.
- Every object is **strict**: an extra key is rejected. On responses this is a
  guarantee that no hash, code or token leaks through a new key.
- All link responses carry `Cache-Control: no-store`.
- Timestamps are ISO-8601 UTC (`2026-10-26T18:04:31.512Z`).

## 2. Flow

1. **Start.** The app calls `POST /companion/v1/devices/link` (no auth) and
   shows the user `userCode` and `verificationUri`, or opens
   `verificationUriComplete` in the browser.
2. **Approve.** The signed-in user opens `/link` on the Raid Ledger site,
   checks the code and device details, and clicks Approve or Deny. Opening the
   link never approves on its own. These web routes (`…/link/preview`,
   `…/link/decision`) are Raid Ledger internal and not part of this contract.
3. **Poll.** Meanwhile the app calls `POST /companion/v1/devices/link/poll`
   every `interval` seconds until it gets the token or a terminal error.
4. **Use.** The app stores the token and sends `Authorization: Bearer rlcd_…`
   on every companion request (`GET /companion/v1/device` and, via the
   envelope contract, ingest).

## 3. Endpoints

### 3.1 `POST /companion/v1/devices/link` — start (public)

Request `$defs/start-request`: `{ device: { name, os, osVersion?, appVersion } }`

| Field | Type | Req | Meaning |
|---|---|---|---|
| `device.name` | string 1–64 after trim, display-safe (§6) | yes | Default device name; the approver may rename it. |
| `device.os` | `windows` \| `macos` \| `linux` \| `other` | yes | |
| `device.osVersion` | string ≤ 32, display-safe | no | Omit if unknown (do not send `null`). |
| `device.appVersion` | `MAJOR.MINOR.PATCH` with optional `-pre`/`+build`, ≤ 32 | yes | |

`200` `$defs/start-response`:

| Field | Type | Meaning |
|---|---|---|
| `deviceCode` | 43 base64url chars | Secret the app polls with. Never show, never log. |
| `userCode` | `XXXX-XXXX`, letters from `BCDFGHJKLMNPQRSTVWXZ` | Show it to the user. Input on the web is case-insensitive and ignores `-` and spaces. |
| `verificationUri` | URL | `<site>/link`. |
| `verificationUriComplete` | URL | `<site>/link#code=XXXX-XXXX`; the code rides in the fragment so it never reaches server or proxy logs. Pre-fills the code only. |
| `expiresIn` | integer seconds | `600` today (10 minutes). Stop polling after it. |
| `interval` | integer seconds | `5` today. Minimum wait between polls. |

Errors: `400 { message: 'Validation failed', errors: string[] }` for a bad
body; `429 { code: 'rate_limited', message }` + `Retry-After` (10 starts/min per
IP); `409 { code: 'too_many_pending', message }` (5 waiting links per network).

### 3.2 `POST /companion/v1/devices/link/poll` — poll (public)

Request `$defs/poll-request`: `{ deviceCode }`.

`200` `$defs/poll-success` — `{ token, tokenType: 'Bearer', device }`. This is
the **only** response that ever carries the raw token, and it is returned
**once**; a later poll with the same `deviceCode` answers `invalid_grant`.
`token` matches `^rlcd_[A-Za-z0-9_-]{43}$`. `device` is the new device as the
owner's Devices list shows it (`id`, `name`, `os`, `osVersion`, `appVersion`,
`tokenHint` = the token's last 4 chars, `createdAt`, `lastUsedAt`,
`lastUsedNetwork`, `revokedAt`, `state`); it never contains a hash.

`400` `$defs/poll-error` — `{ error, interval? }`:

| `error` | Meaning | App action |
|---|---|---|
| `authorization_pending` | Not decided yet. | Wait `interval`, poll again. |
| `slow_down` | Polled sooner than the current interval. `interval` is the **new** interval: +5 s per early poll, capped at 60 s. An early poll also restarts the wait. | Use the returned `interval` from now on. |
| `access_denied` | The user clicked Deny. | Stop; offer to start again. |
| `expired_token` | Past `expiresIn` (checked before the decision). | Stop; start a new link. |
| `invalid_grant` | Unknown, malformed or already-used `deviceCode`. | Stop; start a new link. |

The poll can also answer outside that shape: `409 { code: 'device_limit',
message }` when the approver already has **10** live devices (stop, tell the
user to remove one from their Devices list), and `429 { code: 'rate_limited',
message }` + `Retry-After` after 30 failed (`invalid_grant`) polls per minute
from one IP. Successful and pending polls do not count against that budget.

### 3.3 `GET /companion/v1/device` — token self-check (device token)

`Authorization: Bearer rlcd_…` only; a website session is refused. `200`
`$defs/device-self`: `{ deviceId, name, createdAt }`. Use it at start-up to
confirm the stored token still works and to show the device name.

Every refusal is the same `401 { code: 'unauthorized', message }`: missing or
malformed header, a non-`rlcd_` token, an unknown or revoked token, or an
owner who is deactivated, banned or in a kick cooldown. There is no way to tell
them apart. 30 failed auths per minute per IP → `429 { code: 'rate_limited' }`
+ `Retry-After`.

## 4. Timing rules

- A link lives 600 s from start. The app must not poll before `interval`
  seconds have passed since its previous poll, and should honour `Retry-After`
  on any 429.
- The token has no expiry. It stops working only when revoked (§5) or when the
  owner's account is blocked.
- The server stamps `lastUsedAt` / `lastUsedNetwork` at most once per 60 s.

## 5. Security rules

- **The user code is shown to the user and never logged** by the app or the
  server. The `deviceCode` and the token are never shown and never logged.
- Store the token in the OS credential store (Windows Credential Manager,
  macOS Keychain, libsecret), never in a plain config file. Send it only in
  the `Authorization` header to the Raid Ledger origin it was minted by.
- The server stores only SHA-256 hashes of the device code and token; it cannot
  show the token again. A lost token means linking again.
- **Revocation:** the owner removes the device from their Devices list
  (`DELETE /companion/v1/devices/:id`, web only). From then on every request
  with that token gets the `401` in §3.3; the app should delete the stored
  token and offer to link again. There is no app-side revoke call in v1.
- A user may have at most 10 live (non-revoked) devices.
- Network values are coarse (IPv4 /24, IPv6 /48), never a full address.

## 6. Display-safe text

`device.name` and `device.osVersion` are shown to the approver, so they reject
C0/C1 control characters (including line breaks), U+2028/U+2029, lone
surrogates, bidi overrides and isolates (U+202A–U+202E, U+2066–U+2069) and
whitespace-only text. The `schema.json` pattern uses `\p{…}` classes, so a
validator must compile it in Unicode mode.

## 7. Fixtures

A fixture's filename prefix names its `$defs` entry: `start-request`,
`start-response`, `poll-request`, `poll-success`, `poll-error`,
`device-self`. Every valid fixture must parse; every file in `invalid/` must be
rejected with the `path` + `code` listed under its name in `EXPECTED.json`.
Codes, tokens and names are made up — never commit a real one.
