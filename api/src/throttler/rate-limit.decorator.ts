import { Throttle } from '@nestjs/throttler';

/** When true, all rate limits are effectively disabled (set to 999999). */
const isTestEnv = process.env.THROTTLE_DISABLED === 'true';

/**
 * Tiered rate-limit overrides.
 * The default global throttler allows 60 req/min.
 * These tiers tighten or loosen that limit per use case.
 */
export const RATE_LIMIT_TIERS = {
  auth: { ttl: 60_000, limit: isTestEnv ? 999_999 : 10 },
  search: { ttl: 60_000, limit: isTestEnv ? 999_999 : 30 },
  admin: { ttl: 60_000, limit: isTestEnv ? 999_999 : 120 },
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
