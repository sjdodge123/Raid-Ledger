import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
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
 * Single-use enforcement backed by Postgres for durability across restarts
 * (ROK-979 — migrated from Redis SETNX to DB INSERT ON CONFLICT DO NOTHING).
 */
@Injectable()
export class IntentTokenService {
  private readonly logger = new Logger(IntentTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

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
   * Uses DB INSERT ON CONFLICT DO NOTHING for atomic single-use enforcement.
   * @param token - The JWT to validate
   * @returns The decoded payload, or null if invalid/expired/already used
   */
  async validate(token: string): Promise<IntentTokenPayload | null> {
    let payload: IntentTokenPayload;
    try {
      payload = this.jwtService.verify<IntentTokenPayload>(token);
    } catch {
      this.logger.debug('Intent token validation failed');
      return null;
    }

    const tokenHash = this.hashToken(token);

    const result = await this.db
      .insert(schema.consumedIntentTokens)
      .values({ tokenHash })
      .onConflictDoNothing()
      .returning({ id: schema.consumedIntentTokens.id });

    if (result.length === 0) {
      this.logger.warn('Intent token already used');
      return null;
    }

    return payload;
  }

  /**
   * Hash a token with SHA-256 for storage (avoids storing raw JWTs).
   * @param token - The raw JWT string
   * @returns Hex-encoded SHA-256 hash (64 characters)
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
