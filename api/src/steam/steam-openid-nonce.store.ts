import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/** Redis key prefix; the nonce itself is hashed so keys are fixed-length. */
export const STEAM_NONCE_KEY_PREFIX = 'steam:openid:nonce:';

/**
 * 15 min. Must outlive STEAM_NONCE_MAX_AGE_MS + STEAM_NONCE_FUTURE_SKEW_MS
 * (a nonce older than that is rejected before the store is consulted) and
 * the 10-min link-state life. Asserted in the spec.
 */
export const STEAM_NONCE_TTL_SECONDS = 900;

/**
 * Single-use store for Steam OpenID `openid.response_nonce` (ROK-1731).
 *
 * `claim` is atomic (`SET NX`): the first caller gets true, every later
 * caller within the TTL gets false. Redis errors PROPAGATE — this is an auth
 * guard, so it fails closed (the caller turns the throw into an error
 * redirect) rather than silently skipping the replay check.
 */
@Injectable()
export class SteamOpenIdNonceStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async claim(nonce: string): Promise<boolean> {
    const result = await this.redis.set(
      steamNonceKey(nonce),
      '1',
      'EX',
      STEAM_NONCE_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }
}

export function steamNonceKey(nonce: string): string {
  const digest = createHash('sha256').update(nonce).digest('hex');
  return `${STEAM_NONCE_KEY_PREFIX}${digest}`;
}
