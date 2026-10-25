# ROK-1955 L4 — Handover (device guard, Devices API, web Sentry scrub)

**Status: DONE (unit + tsc + lint + DI preview green); integration specs WRITTEN, NOT RUN (fleet).**
Commits: `bc0bada1c` guard + repo + lock, `001cbd4e7` Devices API, `a6d350801` web scrub, `7ea890197` integration specs.

## Routes (all in `companion-devices.controller.ts`, registered in `CompanionDevicesModule`)
| Route | Auth | Success | Errors |
|---|---|---|---|
| `GET /companion/v1/device` | `CompanionDeviceGuard` (rlcd_ only) | 200 `CompanionDeviceSelf` | 401 `{code:'unauthorized',message:'Invalid device token'}` (one body for every refusal); 429 `rate_limited` + Retry-After (`COMPANION_DEVICE_RATE_AUTH_PER_MIN`, default 30/min/IP, reserve/settle — successes refund) |
| `GET /companion/v1/devices` | JWT | 200 `{data: CompanionDevice[]}` live first, then revoked ≤30 days, `created_at desc` | 401 |
| `PATCH /companion/v1/devices/:id` | JWT | 200 `CompanionDevice` | 400 Zod / ParseInt; 404 `{code:'not_found'}` (other user's id OR revoked) |
| `DELETE /companion/v1/devices/:id` | JWT | 204 (stamps `revoked_at`) | 404 `not_found` (other user's id OR already revoked) |

## Guard (`companion-device.guard.ts`)
Bearer → `companionDeviceTokens.isToken` (malformed/JWT/rlvl_ → 401, NO DB read) → sha256 → `repo.findByHash` (inner join users) → `tokenHashesEqual` → revoked/deactivated → 401. Attaches `req.companionDevice = {deviceId, tokenHash, userId}`; never sets `req.user`. `touchLastUsed` is one conditional UPDATE (`last_used_at IS NULL OR < now() - 60s`), coarse IP only. No logging anywhere. Exported from the module with its repo + limiter for C3.
`holdActiveDevice(tx, auth)` in `companion-device-lock.ts` (FOR SHARE on the device row; revocation only — deactivation is the guard's per-request check). C3 calls it at commit.

## Decisions (keep)
- **No `api/src/auth/**` edit** (D-4): `rlcd_` is refused by `AuthGuard('jwt')` because passport-jwt cannot verify it. Proved by T-API-20/21, not by code.
- Rename IS in scope (spec D-12). Revoked devices cannot be renamed (404).
- "Log out everywhere" does not touch devices (nothing in L4 wires them together — accepted recommendation).
- `truncateAllTables` discovers tables from `pg_tables` dynamically → covers both new tables; no edit.

## Web Sentry (`web/src/lib/sentry-scrub.ts`, `sentry-scrub-secrets.ts`)
`rlcd_<43>` anywhere; the preview path `/(api/)companion/v1/devices/link/<code>` (poll/decision kept); keys `deviceCode`/`device_code`/`userCode`/`user-code` (+ JSON / `k=v`); `/link?code=` was already covered by the URL-param rule (test added). All idempotent; `src/lib` vitest 720/720.

## Fleet must run (integration — never run)
- `api/src/companion/devices/companion-devices.integration.spec.ts` — T-API-16, 16b (30-day hide), 17, 17b (429 with budget 3), 18, 19, 20 (`GET /auth/me`, `PATCH /users/me`), 21 (`GET /users` optional JWT), 22, 23, 24.
- `api/src/companion/devices/companion-device-link-poll.integration.spec.ts` — T-API-1 now also calls `GET /companion/v1/device`.
- `api/src/companion/devices/companion-device-link-decision.integration.spec.ts` (L3, unchanged).
- Unit (green on laptop): `companion-device.guard.spec.ts` (12), `companion-devices.service.spec.ts` (6), `companion-device-token.helpers.spec.ts`.

## Unverified / watch on first fleet run
- T-API-21 asserts the anonymous `/users` body differs from the member body (to make the equality meaningful). If both shapes are identical for these seeds, that last line fails — that would be a weak-fixture issue, not a leak.
- T-API-19 assumes supertest's `req.ip` is a loopback address that `coarseIp` maps (asserts non-null and not the full `127.0.0.1`).
- Integration mutation checks not done (fleet). Unit mutations done: dropping the deactivated check and always counting failures each failed their own assertion.
- DI preview probe: `DI_GRAPH_OK` (after `npm run build -w api`).
- Guard/integration `describe` blocks trip the `max-lines-per-function` WARN (spec files; no errors).
