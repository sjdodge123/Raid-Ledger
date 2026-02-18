import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
 * Shared infrastructure for ROK-137 and reusable by ROK-263 (Magic Invite Links).
 */
@Injectable()
export class IntentTokenService {
  private readonly logger = new Logger(IntentTokenService.name);
  /** Track used tokens to enforce single-use (in-memory; sufficient for 15-min TTL) */
  private readonly usedTokens = new Set<string>();

  constructor(private readonly jwtService: JwtService) {}

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
   * @param token - The JWT to validate
   * @returns The decoded payload, or null if invalid/expired/already used
   */
  validate(token: string): IntentTokenPayload | null {
    try {
      const payload = this.jwtService.verify<IntentTokenPayload>(token);

      // Enforce single-use
      if (this.usedTokens.has(token)) {
        this.logger.warn('Intent token already used');
        return null;
      }

      // Mark as used
      this.usedTokens.add(token);

      // Clean up expired tokens from the set periodically
      // (lazy cleanup: only when set grows large)
      if (this.usedTokens.size > 1000) {
        this.cleanupExpiredTokens();
      }

      return payload;
    } catch {
      this.logger.debug('Intent token validation failed');
      return null;
    }
  }

  /**
   * Remove expired tokens from the used-tokens set.
   */
  private cleanupExpiredTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const token of this.usedTokens) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const decoded = this.jwtService.decode(token);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (decoded?.exp && decoded.exp < now) {
          this.usedTokens.delete(token);
        }
      } catch {
        this.usedTokens.delete(token);
      }
    }
  }
}
