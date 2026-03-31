import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/** TTL in seconds — matches max JWT lifetime (24h). */
const BLOCK_TTL_SECONDS = 86400;

/** Redis key prefix for user-level token blocklist entries. */
const KEY_PREFIX = 'jwt_block:';

/**
 * Redis-backed token blocklist for JWT revocation (ROK-873).
 *
 * Uses a user-level key: `jwt_block:<userId>` = Unix timestamp (seconds).
 * Any token with `iat <= storedTimestamp` is considered revoked.
 * TTL on the key matches the max JWT lifetime so entries self-clean.
 *
 * Graceful degradation: Redis errors are logged but never block auth.
 */
@Injectable()
export class TokenBlocklistService {
  private readonly logger = new Logger(TokenBlocklistService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Block all existing tokens for a user by storing the current timestamp.
   * Tokens issued at or before this timestamp will be rejected.
   */
  async blockUser(userId: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.redis.set(
        `${KEY_PREFIX}${userId}`,
        String(now),
        'EX',
        BLOCK_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to block tokens for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Check whether a token is blocked for the given user.
   * Returns true if the token's `iat` is at or before the stored block timestamp.
   * Returns false (allow) on Redis errors for graceful degradation.
   */
  async isBlocked(userId: number, iat: number): Promise<boolean> {
    try {
      const value = await this.redis.get(`${KEY_PREFIX}${userId}`);
      if (value === null) return false;
      return iat <= Number(value);
    } catch (err) {
      this.logger.warn(
        `Redis blocklist check failed for user ${userId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
