# ROK-1955 L3 — Handover (device-link API: start / poll / preview / decision)

**Status: implemented, tsc + lint clean, unit green; integration specs WRITTEN, NOT RUN (fleet).**
Commits: `ba2204560` helpers+unit, `4d612c003` API, `f71f5197b` refactor, `53778a552` Sentry scrub, then the integration-spec commit.

## Routes (no global prefix in tests; `CompanionModule` registered last in `app.module.ts`)
| Route | Auth | Success | Notes |
|---|---|---|---|
| `POST /companion/v1/devices/link` | public | 200 `CompanionLinkStartResponse` | per-IP 10/min (`COMPANION_LINK_RATE_START_PER_MIN`), ≤5 live pending per coarse network → 409 `too_many_pending` (`COMPANION_LINK_MAX_PENDING_PER_IP`); base URL = `SettingsService.getTrustedClientUrl()` (setting → `CLIENT_URL` → Discord callback origin), 500 if none; `verificationUri = <base>/link`, `…Complete = /link?code=XXXX-XXXX` |
| `POST /companion/v1/devices/link/poll` | public | 200 `CompanionLinkPollSuccess` | 400 `{error}` per RFC 8628; 409 `{code:'device_limit'}`; invalid_grant counts against per-IP 30/min (`COMPANION_LINK_RATE_POLL_FAILS_PER_IP`, reserve/settle) |
| `GET /companion/v1/devices/link/:userCode` | JWT | 200 `CompanionLinkPreview` | one 404 `code_not_found` |
| `POST /companion/v1/devices/link/decision` | JWT + `NotDeactivatedGuard` | 200 `{status:'approved'\|'denied'}` | 404 / 409 `device_limit` / 400 Zod |
All four set `Cache-Control: no-store` before any throw.

## Decisions (keep them)
- **Single use** = `repo.consume()`: tx { `pg_advisory_xact_lock(1955, ownerId)` → count live devices (cap) → `UPDATE … SET status='consumed' WHERE id AND status='approved' AND expires_at>now() RETURNING` → INSERT device → set `device_id` }. Zero rows = lost → re-read once → `invalid_grant`. No catch/retry; `device_limit` returns before any write (link stays approved).
- **Device cap: approve AND final poll** (spec §5.1 default). Lock serialises one user's inserts.
- **slow_down applies to pending links only** (one CTE UPDATE `stampPendingPoll`), so a racing poll on an approved link gets `invalid_grant`, not `slow_down` (T-API-9 deterministic).
- **device_code** (L2 comment contradiction resolved from spec D-8): NOT a bearer, no prefix; hashed via a `createPrefixedTokenKit('', /^[A-Za-z0-9_-]{43}$/)` kit (same sha256) — `deviceCodes` in `companion-device-token.helpers.ts`.
- User-code budget: per-user 10 / 10 min + per-IP 30 / min, reserved BEFORE the lookup; only a 404 counts. Decision Zod 400 does not count.
- Idempotent: same user + same decision (approve also matches `consumed`) → 200; anything else on a decided link → 404.
- Non-RFC error bodies are `{ code, message }` (incl. poll's 409 `device_limit` — the contract's poll error enum has no such code; L5/app treat 409 as terminal).

## For L4 (reuse, don't duplicate)
- `companion-device-link.limits.ts`: `CompanionDeviceRateLimiter` (exported from `CompanionDevicesModule`), `MINUTE_MS`, `MAX_LIVE_DEVICES`. Add the guard's `envLimit` there.
- `companion-device-link-budget.ts`: `reserveOrThrow(limiter, res, specs, msg) → settle(failed)`, `hitOrThrow`.
- `companion-device-dto.helpers.ts`: `toCompanionDeviceDto(row)` (null os → `other`), row types.
- `companion-device-token.helpers.ts`: `companionDeviceTokens` (rlcd_ kit), `coarseIp`.
- `companion-device-links.repository.ts::countLiveDevices(userId, tx?)`.
- Register guard / devices controller / repo in `companion-devices.module.ts`.
- T-API-1's `GET /companion/v1/device` leg: extend `companion-device-link-poll.integration.spec.ts` T-API-1.
- Specs helper: `testing/companion-link.helpers.ts` (`startLink`, `makeUser`, `seedDevices`, `expireLimiterWindows` — time-shifts the limiter's `now`, `withEnv`). Integration env has `THROTTLE_DISABLED=true`, so budget specs set the env var explicitly.

## Scrubbing done
`sentry-scrub.helpers.ts`: `rlcd_<43>` anywhere; `device_?code|user_?code` keys + JSON values; the preview path `/companion/v1/devices/link/<code>` (keeps `poll`/`decision`). `perf-logging.interceptor.ts` logs method + `scrubString(url)` only (no body/headers) → covered by the path regex. Web Sentry (`web/src/lib/sentry-scrub-secrets.ts`) NOT done (L4/L5).

## Unverified
- All integration specs (`companion-device-link-poll.integration.spec.ts`, `companion-device-link-decision.integration.spec.ts`) — never run; Nest DI resolution of `CompanionModule` never booted.
- `truncateAllTables` covers the new tables (assumed dynamic).
- Mutation checks on the integration assertions not done (needs the fleet).
