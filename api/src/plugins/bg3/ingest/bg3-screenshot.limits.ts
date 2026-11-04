/**
 * ROK-1966 review M1 — the per-user hourly allowance for Companion
 * screenshots. The generic companion limits only cap requests per minute;
 * without this one member (or a leaked device token) could fill a hub's
 * shared Gallery cap — the cap Discord ingest and member uploads also use —
 * in about an hour. Same Redis fixed window as member uploads (ROK-1965 D8),
 * on its own key, so a screenshot burst never eats the web upload allowance.
 */
import type Redis from 'ioredis';
import { companionError } from '../../../companion/ingest/companion-ingest.errors';
import {
  hourlyAllowance,
  overHourlyAllowance,
} from '../../../hub-media/hub-media-upload.limits';

const DEFAULT_SCREENSHOTS_PER_HOUR = 20;

/** `HUB_MEDIA_COMPANION_PER_HOUR`, else lifted by `THROTTLE_DISABLED`, else 20. */
export function screenshotsPerHour(): number | null {
  return hourlyAllowance(
    'HUB_MEDIA_COMPANION_PER_HOUR',
    DEFAULT_SCREENSHOTS_PER_HOUR,
  );
}

export const screenshotRateKey = (userId: number): string =>
  `hub-media-companion:${userId}`;

/**
 * Count one stored-screenshot attempt; past the allowance refuse with the
 * retryable `rate_limited` (429). Called from `handle` only — a replay acks
 * `stale` in `alreadyHeld` first and never spends a slot.
 */
export async function checkScreenshotRate(
  redis: Redis,
  userId: number,
): Promise<void> {
  const limit = screenshotsPerHour();
  if (limit === null) return;
  if (await overHourlyAllowance(redis, screenshotRateKey(userId), limit)) {
    throw companionError(
      'rate_limited',
      'Too many screenshots this hour — try again later',
    );
  }
}
