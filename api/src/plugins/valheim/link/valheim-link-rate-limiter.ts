import { Injectable } from '@nestjs/common';
import { positiveIntFromEnv } from '../../../common/rate-limit/env-limit.helpers';
import {
  DEFAULT_RATE_MAX_KEYS,
  FixedWindowRateLimiter,
  type RateLimitHit,
} from '../../../common/rate-limit/fixed-window-rate-limiter';

export { DEFAULT_RATE_MAX_KEYS, type RateLimitHit };

/**
 * Per-key fixed-window counter (ROK-1833) — the shared
 * `FixedWindowRateLimiter` (ROK-1955) with its live-key cap read from
 * `VALHEIM_LINK_RATE_MAX_KEYS` (default 10 000) at construction. Same class
 * name and DI token as before the extraction.
 */
@Injectable()
export class ValheimLinkRateLimiter extends FixedWindowRateLimiter {
  constructor() {
    super(
      positiveIntFromEnv('VALHEIM_LINK_RATE_MAX_KEYS', DEFAULT_RATE_MAX_KEYS),
    );
  }
}
