# ROK-1955 L1 — Handover (shared token kit + rate limiter extraction)

**Status: DONE.** Commits: `ce47c7a61` (new shared modules + specs), `6fa284228` (Valheim rewired, re-exports only).

## Exported surface L3/L4 build on

`api/src/common/tokens/prefixed-token.helpers.ts`
- `PREFIXED_TOKEN_BYTES` (= 32)
- `interface PrefixedTokenKit { generate(); isToken(value); hash(token); verify(token, storedHash); hintOf(token) }`
- `createPrefixedTokenKit(prefix: string, pattern: RegExp): PrefixedTokenKit` — throws at construction if `pattern` has the `g`/`y` flag or does not match its own generated token.
- `tokenHashesEqual(a, b): boolean` — `timingSafeEqual`, false on length mismatch.
- L3 usage: `const kit = createPrefixedTokenKit('rlcd_', COMPANION_DEVICE_TOKEN_PATTERN);` (pattern from L2's contract). `device_code` has NO prefix — do not use the kit for it (`/^…$/` with an empty prefix would work, but D-8 hashes it via the same sha256; a kit with prefix `''` and `/^[A-Za-z0-9_-]{43}$/` is acceptable).

`api/src/common/rate-limit/fixed-window-rate-limiter.ts`
- `class FixedWindowRateLimiter` — `constructor(readonly maxKeys: number)`; `hit`, `isExhausted`, `reserve`, `settle`, `retryAfter`, `size`, `now`, `sweepSteps`. NOT `@Injectable` — subclass it (e.g. `@Injectable() class CompanionDeviceRateLimiter extends FixedWindowRateLimiter { constructor() { super(positiveIntFromEnv('COMPANION_DEVICE_RATE_MAX_KEYS', DEFAULT_RATE_MAX_KEYS)); } }`) so it gets its own DI token and its own map, separate from Valheim's.
- `interface RateLimitHit`, `DEFAULT_RATE_MAX_KEYS` (= 10 000).

`api/src/common/rate-limit/env-limit.helpers.ts`
- `envLimit(env, fallback): number | null` (THROTTLE_DISABLED lifts the default only; DEMO_MODE never).
- `positiveIntFromEnv(env, fallback): number`.
- `rateLimited(message): HttpException` — 429, body `{ code: 'rate_limited', message }`.

## Valheim files (re-export only)
- `valheim-link-token.helpers.ts`: same 7 exports, now wrappers over an `rlvl_` kit.
- `valheim-link-rate-limiter.ts`: `ValheimLinkRateLimiter extends FixedWindowRateLimiter`, reads `VALHEIM_LINK_RATE_MAX_KEYS`; re-exports `DEFAULT_RATE_MAX_KEYS`, `RateLimitHit`.
- `valheim-link-rate-limit.guard.ts`: re-exports `envLimit`, `rateLimited`. Divergence from D-6 wording: the old `rateLimited` built its body via Valheim's `ingestError`; the shared one builds the identical `{ code, message }` object directly so `common/` does not import from `plugins/`.
- Zero `*.spec.ts` changed under `api/src/plugins/valheim/`.

## Evidence
- Laptop unit: `common/tokens`, `common/rate-limit`, `valheim-link-token.helpers.spec`, `valheim-link-token.guard.spec`, `valheim-link-rate-limit.guard.spec`, `valheim-link-tokens.service.spec` — 7 suites / 66 tests green.
- `npx tsc --noEmit -p api/tsconfig.json` (repo root): 0 errors. eslint on touched files: clean.
- Mutations (each reverted): `timingSafeEqual`→`===`, drop shape check in verify, drop length check, drop g/y guard, change 429 code, wrong max-keys env name — each failed its own named assertion.

## Fleet must run (integration, not runnable on laptop)
- `api/src/plugins/valheim/link/valheim-link-tokens-admin.integration.spec.ts`
- `api/src/plugins/valheim/link/ingest/valheim-link-ingest.integration.spec.ts`
- `api/src/plugins/valheim/link/valheim-link-demo-seed.integration.spec.ts`
- plus the unit set above and `api/src/drizzle/schema/valheim-link.schema.spec.ts`, `api/src/sentry/sentry-scrub.helpers.spec.ts` (untouched; sanity).
