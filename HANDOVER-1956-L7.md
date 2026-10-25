# ROK-1956 — L7 handover (`GET /companion/v1/config`)

Branch `feat/rok-1956-companion-ingest`. L7 is DONE; nothing is red. The ROK-1969 ownership-scan part is SKIPPED (ROK-1969 is not on main).

## Commits
- `eeb15e222` guard + service + controller + `CompanionConfigModule`, wired into `CompanionModule`, unit specs
- (last) `companion-config.integration.spec.ts` (I-22, I-23; written, NOT run) + this handover

Evidence: `npx jest src/companion/config` (from `api/`) 13/13; `tsc --noEmit -p api/tsconfig.json` (repo root) clean; eslint 0 errors on `src/companion/config`; Nest DI preview probe `DI_GRAPH_OK` (dist contained the config module).
Mutations, each failing its own assertion: guard treats an empty `Authorization` as anonymous ("Received promise resolved instead of rejected"); service resolves with `'device'` instead of the caller's `via` ("Expected: false / Received: true").

## Files (`api/src/companion/config/`)
- `companion-config-auth.guard.ts`: `CompanionConfigAuthGuard`. No `Authorization` header → anonymous (nothing attached). Any header, even an empty one → `CompanionIngestAuthGuard` (D-17); its 401 is final (no silent downgrade).
- `companion-config.service.ts`: `CompanionConfigService.build(auth | null)`, parsed through `CompanionConfigSchema` before return. `DEFAULT_COMPANION_MIN_APP_VERSION = '0.0.0'`; env `COMPANION_MIN_APP_VERSION` read per call; an invalid value logs a warning and falls back. The server does NOT enforce it (Q8).
  - Anonymous: `{configVersion: 1, minAppVersion, limits}`.
  - Device / session: plus `rate` (`callerRatePerMin` for messages + blobs; `null` = unlimited, e.g. `THROTTLE_DISABLED`) and `contracts[]`: every `COMPANION_CONTRACTS` id (or the `COMPANION_CONTRACT_TABLE` override), `enabled` = `registry.resolve(id, currentVersion, via) !== null`, versions ascending with status, `maxBytes`/`blobSlots` of the current version, `cadence` from the registered handler covering the current version, else 120.
- `companion-config.controller.ts`: `@Get()`, `@Header('Cache-Control', 'no-store')`. No `@SkipThrottle` (the global throttler applies). No connection-close filter (GET, JSON parser not bypassed).
- `companion-config.module.ts`: imports `CompanionDevicesModule` + `CompanionIngestModule` (for the registry singleton). Lists `CompanionIngestAuthGuard`, `CompanionSessionJwtGuard`, `CompanionConfigAuthGuard`, `CompanionConfigService`. Carries the `TODO(ROK-1969)` for `companionHandlers()` in `hub-registration-scan.ts`.

## For the fleet run (I-22, I-23)
- Run alone via `rl_run_on_runner` with the Redis sidecar. It registers a bg3-save v1 handler owned by Pelican (cadence 300), but only if the shared registry has none yet. If it shares an app with the ingest spec, the cadence assertion (300) would see the ingest handler's 120. Jest gives each file its own globals, so this is UNVERIFIED but unlikely.
- "No handler" is tested on a fresh `CompanionHandlerRegistry` + service (no HTTP), the way I-5 does it.
- The session case expects `enabled:false` (device-only handler) — this proves sources are honoured per caller.

## Deliberate choices
- One file beyond the L7 row: `companion-config-auth.guard.ts` (the spec's "guard variant of D-17"). Controller 26 lines, service ~120 raw (under the ≤110 counted budget once comments are stripped).
- "Credential present" = an `Authorization` header exists. The JWT strategy only reads the Bearer header (`ExtractJwt.fromAuthHeaderAsBearerToken`), so cookies are not considered.
- A deactivated or impersonation session gets 401 (inherited from D-17), not anonymous.
- A 401 response does not carry `no-store` (Nest `@Header` applies to success only). It has no caller data.
- ROK-1969 ownership scan: NOT done. ROK-1969 is not on main; only the TODO.
