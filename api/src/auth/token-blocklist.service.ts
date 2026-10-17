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
 * ROK-1810 Codex r3: the global block sequence — the highest stamp any
 * `blockUser` has written (any user). Lives under `KEY_PREFIX` so the
 * integration helpers' `jwt_block:*` sweep clears it with the user keys.
 */
export const BLOCK_SEQ_KEY = `${KEY_PREFIX}seq`;

/**
 * ROK-1810: atomic monotonic block write. KEYS[1] = the user's block key,
 * KEYS[2] = `BLOCK_SEQ_KEY`, ARGV[1] = floor(now) in seconds, ARGV[2] = TTL
 * seconds. Stores (in both keys) and returns
 * `max(now, previous + 1, sequence + 1)`; a missing or non-numeric value
 * counts as absent. Why the global sequence (Codex r3): a token's `iat` is
 * raised past EVERY live floor of the ids it carries (`minIatFor` = stamp +
 * 1), so an impersonation token minted after the TARGET's block carries
 * `targetStamp + 1`; the ADMIN's block in the same second must still cover
 * it. Every stamp is above every earlier stamp, so any token minted before a
 * block (iat <= max(now, any earlier stamp + 1)) is covered, whichever
 * identity raised it. `nextBlockStamp` is its JS twin (in-memory Redis).
 */
export const BLOCK_USER_SCRIPT = `
local now = tonumber(ARGV[1])
local prev = tonumber(redis.call('GET', KEYS[1]))
local seq = tonumber(redis.call('GET', KEYS[2]))
local stamp = now
if prev ~= nil and prev + 1 > stamp then stamp = prev + 1 end
if seq ~= nil and seq + 1 > stamp then stamp = seq + 1 end
local text = string.format('%d', stamp)
redis.call('SET', KEYS[1], text, 'EX', ARGV[2])
redis.call('SET', KEYS[2], text, 'EX', ARGV[2])
return stamp
`;

/** A stored stamp as a number, or undefined when absent / non-numeric. */
function storedStamp(value: string | null): number | undefined {
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** JS twin of `BLOCK_USER_SCRIPT`'s stamp rule, for in-memory Redis mocks. */
export function nextBlockStamp(
  previous: string | null,
  sequence: string | null,
  now: number,
): number {
  let stamp = now;
  for (const value of [storedStamp(previous), storedStamp(sequence)]) {
    if (value !== undefined) stamp = Math.max(stamp, value + 1);
  }
  return stamp;
}

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
   * Block all existing tokens for a user. Tokens with `iat <=` the stored
   * stamp are rejected. ROK-1810: the stamp is MONOTONIC across ALL users —
   * `max(floor(now), previous + 1, sequence + 1)`, written atomically by
   * `BLOCK_USER_SCRIPT` — because a token minted after a block carries
   * `iat = stamp + 1` (`minIatFor`), so a stamp can exceed `floor(now)`; a
   * later same-second block of this OR another identity on that token
   * (impersonation) must still cover it. TTL is refreshed each time.
   * Resolves `false` when Redis failed (logged, never thrown) so a caller
   * that must not report success silently (ROK-1810) can surface it.
   */
  async blockUser(userId: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.redis.eval(
        BLOCK_USER_SCRIPT,
        2,
        `${KEY_PREFIX}${userId}`,
        BLOCK_SEQ_KEY,
        String(now),
        String(BLOCK_TTL_SECONDS),
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
