# ROK-1956 — L2 handover (registry + guards + body bypass)

Branch `feat/rok-1956-companion-ingest`. L2 is DONE; nothing is red. Next: L3 (messages route) and L5 (blobs).

## Commits
- `592370f14` errors, connection-close filter, body bypass + `main.ts` / `test-app.ts` installs
- `a155f4733` handler registry + `companion-ingest-request.ts`
- `00444565d` auth + rate-limit guards

Evidence: `npx jest src/companion/ingest` 69/69; `tsc --noEmit -p api/tsconfig.json` (repo root) clean; eslint 0 errors.
Mutations, each failing its own assertion: drop the session deactivated check; drop `isActive` in `resolve`; install the bypass after `useBodyParser('json')` in main.ts; break the `rlcd_` routing prefix.

## Files (all in `api/src/companion/ingest/`)
- `companion-ingest.errors.ts`: `companionError(code, message, {currentVersion?, issues?})` returns an `HttpException` with the §9 status (`COMPANION_ERROR_STATUS`). Message is capped at 200 and issues at 20. Also `companionIssues(zodIssues)` (path + code only), `companionUnauthorized()` and `companionBodyErrors: BoundedBodyErrors` (bad gzip → 400 `invalid_envelope`, Q10).
- `companion-connection-close.filter.ts`: `CompanionConnectionCloseFilter`, a copy of the Valheim filter.
- `companion-body-bypass.ts`: covers ONLY `/companion/v1/messages/` and `/companion/v1/blobs/` (case-insensitive). The device-link, Devices API and config routes keep their JSON parsing. The original header is parked on `req[COMPANION_CONTENT_TYPE]` (`'companionContentType'`). Pass it as `readBoundedBody(..., { rawContentType: req[COMPANION_CONTENT_TYPE] })`.
- `main.ts` / `test-app.ts`: one import, plus `installCompanionBodyBypass(app);` (with a comment) right after `installValheimLinkBodyBypass(app)`. That puts it before `installFeedbackBodyParser` and the 2 MB JSON parser. No parser limit changed.
- `companion-ingest-request.ts`: `CompanionIngestAuth {userId, via, deviceId|null, tokenHash|null}`, `CompanionIngestRequest`, `AuthenticatedCompanionIngestRequest`.
- `companion-handler.registry.ts`: `CompanionHandlerRegistry` plus the §5 types (`CompanionContractHandler<M>`, `CompanionHandlerContext`), `COMPANION_CONTRACT_TABLE` (DI token, `@Optional`, default `COMPANION_CONTRACTS`) and `COMPANION_DEFAULT_MIN_INTERVAL_SEC = 120`.
  - `register(owner, h)` is all-or-nothing. It throws on: empty owner, unknown/prototype id, unlisted/retired/repeated version, empty versions, empty sources, non-positive cadence, or a duplicate `(contract, version)` across owners.
  - `resolve(contract, version, via)` returns null when the version is unregistered, the owner is inactive (`PluginRegistryService.isActive`, read per call) or `via` is not in `sources` (default `['device']`).
  - `list()` returns `{ownerPluginId, contract, versions, sources, cadence, active}` for L7's `/config`.
- `companion-ingest-auth.guard.ts`: `CompanionIngestAuthGuard(device: CompanionDeviceGuard, session: CompanionSessionJwtGuard)`.
  - A `Bearer rlcd_` header goes to the device guard. Its own 401 or pre-auth 429 passes through. It never falls back to a session and never sets `req.user`.
  - Anything else goes to `CompanionSessionJwtGuard` (`AuthGuard('jwt')`, defined in this file). A 401/403 from it becomes the companion 401; non-HTTP errors are rethrown (500).
  - A session user with `deactivatedAt` or `impersonatedBy` set is refused.
- `companion-ingest-rate-limit.guard.ts`: `CompanionIngestRateLimitGuard(Reflector, CompanionDeviceRateLimiter)` with `@CompanionIngestRateBucket('blobs')` (default `messages`).
  - The device path is counted per device and per user; the session path per user. Keys are `companion-ingest:<bucket>:device|user:<id>`.
  - Defaults: messages 30/60 and blobs 20/40 per minute. Env overrides: `COMPANION_INGEST_RATE_{MESSAGES,BLOBS}_PER_{DEVICE,USER}_PER_MIN`.
  - `callerRatePerMin(bucket, via)` is for `/config`.

## For L3 / L5 (module wiring — NOT done here)
- Providers: `CompanionHandlerRegistry`, `CompanionIngestAuthGuard`, `CompanionSessionJwtGuard`, `CompanionIngestRateLimitGuard`. Import `CompanionDevicesModule` (exports the device guard, repo and limiter). `PluginRegistryService` is `@Global`. Export the registry.
- Controllers: `@UseFilters(CompanionConnectionCloseFilter) @UseGuards(CompanionIngestAuthGuard, CompanionIngestRateLimitGuard) @SkipThrottle()`. Blobs also need `@CompanionIngestRateBucket('blobs')`.
- Run the Nest DI preview probe. `CompanionSessionJwtGuard` needs passport's `jwt` strategy registered (AuthModule); it is UNVERIFIED that this is reachable from `CompanionModule`.
- Commit-time device revalidation: when `auth.via === 'device'`, call `holdActiveDevice(tx, {deviceId, tokenHash})`. Both fields are non-null on that path, so narrow on `via`.

## Deliberate choices
- An impersonation session is refused for ingest. This is not in the spec; it errs safe. The Lead can lift it.
- The device bucket is counted before the user bucket. A device over its own cap does not spend the user's budget, but a user-cap 429 has already counted that device hit.
- Over the spec's counted-line budgets: registry 143 (spec ≤120) and rate guard 99 (≤90). Both are far under the 300 lint cap. The extra lines are the validation helpers and the `/config` helper.
- No ownership-scan change (`companionHandlers()`). That is L7 and conditional on ROK-1969.
