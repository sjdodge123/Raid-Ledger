/**
 * ROK-1955: device-link timings, caps and the env-driven rate limits
 * (`envLimit`: read per call; THROTTLE_DISABLED lifts a default only).
 */
import { Injectable } from '@nestjs/common';
import { FixedWindowRateLimiter } from '../../common/rate-limit/fixed-window-rate-limiter';
import {
  envLimit,
  positiveIntFromEnv,
} from '../../common/rate-limit/env-limit.helpers';
import { DEFAULT_RATE_MAX_KEYS } from '../../common/rate-limit/fixed-window-rate-limiter';

/** Link lifetime (D-9). */
export const LINK_TTL_SEC = 600;
/** Initial poll interval (D-9). */
export const POLL_INTERVAL_SEC = 5;
/** Added to a link's interval on each `slow_down`, capped below. */
export const SLOW_DOWN_STEP_SEC = 5;
export const MAX_POLL_INTERVAL_SEC = 60;
/** Live (non-revoked) devices per user (D-15). */
export const MAX_LIVE_DEVICES = 10;
export const MINUTE_MS = 60_000;
export const TEN_MINUTES_MS = 10 * MINUTE_MS;

/** Link starts per minute per IP. */
export const startPerIpLimit = (): number | null =>
  envLimit('COMPANION_LINK_RATE_START_PER_MIN', 10);
/** Live pending links per coarse network (409 `too_many_pending`). */
export const pendingPerNetworkLimit = (): number | null =>
  envLimit('COMPANION_LINK_MAX_PENDING_PER_IP', 5);
/** Failed polls (unknown / malformed / used device code) per minute per IP. */
export const pollFailsPerIpLimit = (): number | null =>
  envLimit('COMPANION_LINK_RATE_POLL_FAILS_PER_IP', 30);
/** Failed user-code lookups per 10 minutes per user. */
export const codeFailsPerUserLimit = (): number | null =>
  envLimit('COMPANION_LINK_RATE_CODE_FAILS_PER_USER', 10);
/** Failed user-code lookups per minute per IP. */
export const codeFailsPerIpLimit = (): number | null =>
  envLimit('COMPANION_LINK_RATE_CODE_FAILS_PER_IP', 30);

/** The companion limiter: its own DI token and key map (not Valheim's). */
@Injectable()
export class CompanionDeviceRateLimiter extends FixedWindowRateLimiter {
  constructor() {
    super(
      positiveIntFromEnv(
        'COMPANION_DEVICE_RATE_MAX_KEYS',
        DEFAULT_RATE_MAX_KEYS,
      ),
    );
  }
}
