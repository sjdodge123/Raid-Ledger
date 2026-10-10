import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as crypto from 'crypto';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { getSessionLengthDays } from '../../settings/settings-session.helpers';
import { TokenBlocklistService } from '../token-blocklist.service';
import { deactivatedException } from '../auth-status.helpers';
import {
  type AuthMethod,
  generateRawToken,
  hashToken,
} from './refresh-token.helpers';
import { defined } from '../../common/defined.helpers';
import { REDIS_CLIENT } from '../../redis/redis.module';
import type Redis from 'ioredis';
import {
  claimGraceOnce,
  indeterminateReplayError,
  replayVerdict,
} from './refresh-grace.helpers';

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
 * and mints its child; reuse of a consumed row (outside the 10 s race grace)
 * is treated as theft → the whole family is revoked + the user is
 * blocklisted. ROK-1755: inside the grace a parent mints at most one
 * sibling; later in-window replays get a non-revoking 409 `refresh_raced`.
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
   * success, or null when the caller should reject with 401. Throws 409/503
   * (no revoke) for an in-window race beyond the one sibling / a Redis error.
   * ROK-1753: a deactivated holder gets a 401 `USER_DEACTIVATED` BEFORE the
   * consume, so nothing rotates or revokes and reactivation resumes the token.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshToken | null> {
    const presentedHash = hashToken(rawToken);
    if (await this.holderIsDeactivated(presentedHash)) {
      throw deactivatedException();
    }
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

  /** ROK-1753: does the presented token belong to a deactivated user? */
  private async holderIsDeactivated(tokenHash: string): Promise<boolean> {
    const [row] = await this.db
      .select({ deactivatedAt: schema.users.deactivatedAt })
      .from(schema.refreshTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.refreshTokens.userId))
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row?.deactivatedAt != null;
  }

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
      .set({
        replacedBy: defined(child, 'inserted child refresh token row').id,
      })
      .where(eq(schema.refreshTokens.id, parent.id));
    return { rawToken, maxAgeMs, userId: parent.userId };
  }

  /**
   * No row was consumed: classify why. Replaying an already-CONSUMED
   * (rotated, not-revoked) token is reuse/theft — revoke the whole family +
   * blocklist the user so the live child dies too (standard rotation-with-
   * reuse-detection). A merely revoked/expired/unknown token → 401 only.
   *
   * RACE GRACE (Codex P1, 2026-06-07): tabs share ONE cookie but the web
   * single-flight only coordinates within a single JS context — a browser
   * session-restore can fire several refreshes with the same parent before
   * any Set-Cookie lands. A parent rotated within the last RACE_GRACE_MS is
   * therefore a race LOSER, not a thief: mint it ONE sibling child on the
   * same family. ROK-1755: further in-window replays throw a non-revoking
   * 409 `refresh_raced` (a Redis failure → 503); replays older than the grace
   * are treated as theft.
   */
  private async handleNoConsume(
    tokenHash: string,
  ): Promise<IssuedRefreshToken | null> {
    const existing = await this.findActiveByHash(tokenHash);
    if (!existing) return null;
    if (existing.revokedAt) return null;
    if (!existing.rotatedAt) return null;
    const rotatedAgoMs = Date.now() - existing.rotatedAt.getTime();
    const verdict = await replayVerdict(rotatedAgoMs, () =>
      claimGraceOnce(this.redis, existing.id),
    );
    const indeterminate = indeterminateReplayError(verdict);
    if (indeterminate) throw indeterminate;
    if (verdict === 'sibling') {
      this.logger.debug(
        `ROK-1353: concurrent-refresh race loser for user ${existing.userId} (rotated ${rotatedAgoMs}ms ago) — minting sibling`,
      );
      return this.mintChild(existing);
    }
    this.logger.warn(
      `ROK-1353: refresh-token reuse detected for user ${existing.userId} — revoking family`,
    );
    await this.revokeFamily(existing.familyId);
    await this.blocklist.blockUser(existing.userId);
    return null;
  }

  /** Configured session length in ms (default 60d). */
  private async sessionMaxAgeMs(): Promise<number> {
    const days = await getSessionLengthDays(this.settings);
    return days * 24 * 60 * 60 * 1000;
  }
}
