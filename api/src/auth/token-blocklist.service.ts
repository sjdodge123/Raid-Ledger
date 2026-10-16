import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * TTL in seconds. Kept at 24h even though access JWTs are now 1h (ROK-1353):
 * pre-rollout tokens were minted with 24h exp, and a blocklist entry that
 * outlives every possible token costs nothing (keys self-clean) while a
 * shorter one lets a revoked-but-unexpired token regain access (Codex P1).
 */
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
   * Resolves `false` when Redis failed (logged, never thrown) so a caller
   * that must not report success silently (ROK-1810) can surface it.
   */
  async blockUser(userId: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.redis.set(
        `${KEY_PREFIX}${userId}`,
        String(now),
        'EX',
        BLOCK_TTL_SECONDS,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to block tokens for user ${userId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * ROK-1810: the lowest `iat` a token minted NOW for this user may carry and
   * still pass `isBlocked` (`stamp + 1`), or `undefined` when no block is
   * live. A token minted in the same second as a block would otherwise be
   * born revoked. Redis errors → `undefined` (mint with the normal iat).
   */
  async minIatFor(userId: number): Promise<number | undefined> {
    try {
      const value = await this.redis.get(`${KEY_PREFIX}${userId}`);
      if (value === null) return undefined;
      const stamp = Number(value);
      return Number.isFinite(stamp) ? stamp + 1 : undefined;
    } catch (err) {
      this.logger.warn(
        `Redis blocklist floor read failed for user ${userId}: ${(err as Error).message}`,
      );
      return undefined;
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
