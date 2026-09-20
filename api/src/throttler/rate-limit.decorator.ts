import { Throttle } from '@nestjs/throttler';

/** When true, all rate limits are effectively disabled (set to 999999). */
const isTestEnv = process.env.THROTTLE_DISABLED === 'true';

/**
 * ROK-1633: a fleet/demo env puts every Playwright worker (three projects,
 * ~14 workers) behind ONE IP, so `search` and `refresh` ran dry in seconds and
 * the web rendered the 429s as "No games found" / "We couldn't find that game"
 * — different unrelated specs hard-failed on every gate. DEMO_MODE already
 * lifts the global throttler (throttler.module.ts); these per-route overrides
 * win over it, so the two browse-path tiers follow it here. `auth`, `admin`,
 * `export` and `public` deliberately do NOT: fleet envs are public and carry a
 * stable admin password. Production sets neither variable.
 */
const isBrowseRelaxed = isTestEnv || process.env.DEMO_MODE === 'true';

/**
 * Tiered rate-limit overrides.
 * The default global throttler allows 60 req/min.
 * These tiers tighten or loosen that limit per use case.
 */
export const RATE_LIMIT_TIERS = {
  auth: { ttl: 60_000, limit: isTestEnv ? 999_999 : 10 },
  search: { ttl: 60_000, limit: isBrowseRelaxed ? 999_999 : 30 },
  admin: { ttl: 60_000, limit: isTestEnv ? 999_999 : 120 },
  export: { ttl: 60_000, limit: isTestEnv ? 999_999 : 5 },
  // ROK-1067: per-IP throttle for public-share lineup endpoint.
  public: { ttl: 60_000, limit: isTestEnv ? 999_999 : 60 },
  // ROK-1353: POST /auth/refresh is browser-automatic (fires on page mounts
  // and 401 retries, including anonymous visitors' probes), so a whole guild
  // behind one NAT shares the bucket. The 'auth' tier's 10/min trips under
  // normal multi-tab use and forces spurious logouts. Token brute force is
  // not a concern (256-bit random, hash-matched), so match the global 60/min.
  refresh: { ttl: 60_000, limit: isBrowseRelaxed ? 999_999 : 60 },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

/**
 * Convenience decorator that maps a tier name to @Throttle() overrides.
 *
 * Usage: `@RateLimit('auth')` on a controller method or class.
 */
export function RateLimit(
  tier: RateLimitTier,
): MethodDecorator & ClassDecorator {
  const { ttl, limit } = RATE_LIMIT_TIERS[tier];
  return Throttle({ default: { ttl, limit } });
}
