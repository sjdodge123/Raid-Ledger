import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';
import type { IntentTokenPayload } from '@raid-ledger/contract';

/** Intent token TTL: 15 minutes (matches Discord interaction timeout) */
const INTENT_TOKEN_TTL = 15 * 60;

/**
 * Service for generating and validating intent tokens (ROK-137).
 *
 * Intent tokens are signed JWTs that encode a user's intent to perform
 * an action after completing Discord OAuth. Used for the "Join & Sign Up"
 * deferred signup flow where an unlinked Discord user creates an RL account
 * and auto-completes a signup.
 *
 * Single-use enforcement backed by Redis for correctness across restarts
 * and multi-instance deployments.
 */
@Injectable()
export class IntentTokenService {
  private readonly logger = new Logger(IntentTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  /**
   * Generate a signed intent token for deferred signup.
   * @param eventId - Event the user wants to sign up for
   * @param discordId - Discord user ID of the requester
   * @returns Signed JWT string
   */
  generate(eventId: number, discordId: string): string {
    const payload: IntentTokenPayload = {
      eventId,
      discordId,
      action: 'signup',
    };

    return this.jwtService.sign(payload, { expiresIn: INTENT_TOKEN_TTL });
  }

  /**
   * Validate and consume an intent token (single-use).
   * Uses Redis SETNX for atomic single-use enforcement.
   * @param token - The JWT to validate
   * @returns The decoded payload, or null if invalid/expired/already used
   */
  async validate(token: string): Promise<IntentTokenPayload | null> {
    try {
      const payload = this.jwtService.verify<IntentTokenPayload>(token);

      // Atomic single-use check via Redis SETNX (set-if-not-exists)
      // Key auto-expires after the token TTL to prevent unbounded growth
      const redisKey = `intent_used:${token}`;
      const wasSet = await this.redis.set(redisKey, '1', 'EX', INTENT_TOKEN_TTL, 'NX');

      if (!wasSet) {
        this.logger.warn('Intent token already used');
        return null;
      }

      return payload;
    } catch {
      this.logger.debug('Intent token validation failed');
      return null;
    }
  }
}

