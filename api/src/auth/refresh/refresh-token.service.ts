import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as crypto from 'crypto';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { getSessionLengthDays } from '../../settings/settings-session.helpers';
import { TokenBlocklistService } from '../token-blocklist.service';
import {
  type AuthMethod,
  generateRawToken,
  hashToken,
  isWithinGrace,
} from './refresh-token.helpers';

/** Result of issuing/rotating: the raw token (for the cookie) + lifetime. */
export interface IssuedRefreshToken {
  rawToken: string;
  maxAgeMs: number;
  userId: number;
}

/**
 * ROK-1353: refresh-token rotation service.
 *
 * issue() mints a new family; rotate() atomically consumes the presented row
 * and mints its child; reuse of a consumed row (outside the ±60s grace) is
 * treated as theft → the whole family is revoked + the user is blocklisted.
 * revokeAllForUser/revokeFamily back logout + deactivation.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly blocklist: TokenBlocklistService,
  ) {}

  /** Mint a brand-new refresh family for a fresh login. */
  async issue(
    userId: number,
    opts: { authMethod: AuthMethod; userAgent?: string | null },
  ): Promise<IssuedRefreshToken> {
    const maxAgeMs = await this.sessionMaxAgeMs();
    const rawToken = generateRawToken();
    const familyId = crypto.randomUUID();
    await this.db.insert(schema.refreshTokens).values({
      userId,
      tokenHash: hashToken(rawToken),
      familyId,
      authMethod: opts.authMethod,
      userAgent: opts.userAgent ?? null,
      expiresAt: new Date(Date.now() + maxAgeMs),
    });
    return { rawToken, maxAgeMs, userId };
  }

  /**
   * Rotate the presented token. Atomic consume via conditional UPDATE; on a
   * 0-row result, disambiguate race-loser (accept) vs reuse (revoke family)
   * vs unknown/expired (401 — caller throws). Returns the new token on
   * success, or null when the caller should reject with 401.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshToken | null> {
    const presentedHash = hashToken(rawToken);
    const consumed = await this.consumeRow(presentedHash);
    if (consumed) return this.mintChild(consumed);
    return this.handleNoConsume(presentedHash);
  }

  /** Revoke every active refresh row for a user (deactivation). */
  async revokeAllForUser(userId: number): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: sql`NOW()` })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  /** Revoke every active row in a family (logout / reuse-detection). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: sql`NOW()` })
      .where(
        and(
          eq(schema.refreshTokens.familyId, familyId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  /** Look up an active (un-rotated, un-revoked, unexpired) row by hash. */
  async findActiveByHash(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Atomically consume the row if it is live; returns it or undefined. */
  private async consumeRow(tokenHash: string) {
    const [row] = await this.db
      .update(schema.refreshTokens)
      .set({ rotatedAt: sql`NOW()` })
      .where(
        and(
          eq(schema.refreshTokens.tokenHash, tokenHash),
          isNull(schema.refreshTokens.rotatedAt),
          isNull(schema.refreshTokens.revokedAt),
          sql`${schema.refreshTokens.expiresAt} > NOW()`,
        ),
      )
      .returning();
    return row;
  }

  /** Mint the child row for a successfully consumed parent. */
  private async mintChild(parent: typeof schema.refreshTokens.$inferSelect) {
    const maxAgeMs = await this.sessionMaxAgeMs();
    const rawToken = generateRawToken();
    const childHash = hashToken(rawToken);
    const [child] = await this.db
      .insert(schema.refreshTokens)
      .values({
        userId: parent.userId,
        tokenHash: childHash,
        familyId: parent.familyId,
        authMethod: parent.authMethod,
        userAgent: parent.userAgent,
        expiresAt: new Date(Date.now() + maxAgeMs),
      })
      .returning({ id: schema.refreshTokens.id });
    await this.db
      .update(schema.refreshTokens)
      .set({ replacedBy: child.id })
      .where(eq(schema.refreshTokens.id, parent.id));
    return { rawToken, maxAgeMs, userId: parent.userId };
  }

  /**
   * No row was consumed: classify why. Already-consumed within grace →
   * race loser, reject quietly (401). Consumed long ago → reuse: revoke
   * family + blocklist. Revoked/expired/unknown → 401.
   */
  private async handleNoConsume(
    tokenHash: string,
  ): Promise<IssuedRefreshToken | null> {
    const existing = await this.findActiveByHash(tokenHash);
    if (!existing) return null;
    if (existing.revokedAt) return null;
    if (existing.rotatedAt && !isWithinGrace(existing.rotatedAt)) {
      this.logger.warn(
        `ROK-1353: refresh-token reuse detected for user ${existing.userId} — revoking family`,
      );
      await this.revokeFamily(existing.familyId);
      await this.blocklist.blockUser(existing.userId);
    }
    return null;
  }

  /** Configured session length in ms (default 60d). */
  private async sessionMaxAgeMs(): Promise<number> {
    const days = await getSessionLengthDays(this.settings);
    return days * 24 * 60 * 60 * 1000;
  }
}
