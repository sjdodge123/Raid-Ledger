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
  rotationAgeMs,
} from './refresh-grace.helpers';
import {
  DB_CLOCK,
  findReplayCandidate,
  markFirstChildIssued,
} from './refresh-rotation.helpers';
import { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import type { ImpersonationEndReason } from '../impersonation/impersonation-session.helpers';

/** Result of issuing/rotating: the raw token (for the cookie) + lifetime. */
export interface IssuedRefreshToken {
  rawToken: string;
  maxAgeMs: number;
  userId: number;
  /** ROK-1754: the refresh family — keys the impersonation marker. */
  familyId: string;
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
    private readonly impersonation: ImpersonationSessionService,
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
    return { rawToken, maxAgeMs, userId, familyId };
  }

  /**
   * Rotate the presented token. Atomic consume via conditional UPDATE; on a
   * 0-row result, disambiguate race-loser (accept) vs reuse (revoke family)
   * vs unknown/expired (401 — caller throws). Returns the new token on
   * success, or null when the caller should reject with 401. Throws 409/503
   * (no revoke) for an in-window race beyond the one sibling / a Redis error.
   * ROK-1753: a deactivated (not banned) holder gets a 401 `USER_DEACTIVATED`
   * BEFORE the consume, so nothing rotates or revokes and reactivation
   * resumes the token. A banned holder keeps the original ban behaviour.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshToken | null> {
    const presentedHash = hashToken(rawToken);
    if (await this.holderIsDeactivated(presentedHash)) {
      throw deactivatedException();
    }
    const consumed = await this.consumeRow(presentedHash);
    if (consumed) return this.mintChild(consumed, true);
    return this.handleNoConsume(presentedHash);
  }

  /**
   * Revoke every active refresh row for a user (deactivation, ban). ROK-1754:
   * also ends every impersonation this user is running.
   */
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
    await this.endImpersonationBestEffort(`user ${userId}`, () =>
      this.impersonation.endForUser(userId, 'session_revoked'),
    );
  }

  /**
   * Revoke every active row in a family (logout / reuse-detection). ROK-1754:
   * also ends the family's impersonation marker with `reason` (logout passes
   * `logout`).
   */
  async revokeFamily(
    familyId: string,
    reason: ImpersonationEndReason = 'session_revoked',
  ): Promise<void> {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: sql`NOW()` })
      .where(
        and(
          eq(schema.refreshTokens.familyId, familyId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
    await this.endImpersonationBestEffort(`family ${familyId}`, () =>
      this.impersonation.end(familyId, reason),
    );
  }

  /**
   * ROK-1754: ending a marker (delete + audit) runs AFTER the revoke and never
   * throws, so an audit failure cannot skip the revoke, the reuse-path
   * `blockUser`, or logout's cookie clear. A marker left behind is harmless:
   * its family is revoked, so `/auth/refresh` can never resume it.
   */
  private async endImpersonationBestEffort(
    what: string,
    end: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await end();
    } catch (err: unknown) {
      this.logger.error(
        `ROK-1754: ending impersonation for ${what} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  /**
   * ROK-1753: does the presented token belong to a deactivated, NOT banned
   * user? A ban also stamps `deactivatedAt`, so a banned holder falls through
   * to the pre-ROK-1753 rotate path (same ban-first precedence as
   * JwtStrategy). Runs for any hash, so a deactivated user's replayed
   * consumed token skips reuse detection — harmless: deactivation already
   * revoked every family, and detection resumes after reactivation.
   */
  private async holderIsDeactivated(tokenHash: string): Promise<boolean> {
    const [row] = await this.db
      .select({
        deactivatedAt: schema.users.deactivatedAt,
        bannedAt: schema.users.bannedAt,
      })
      .from(schema.refreshTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.refreshTokens.userId))
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row?.deactivatedAt != null && row.bannedAt == null;
  }

  /** Atomically consume the row if it is live; returns it or undefined. */
  private async consumeRow(tokenHash: string) {
    const [row] = await this.db
      .update(schema.refreshTokens)
      .set({ rotatedAt: DB_CLOCK })
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

  /**
   * Mint the child row for a consumed parent. Only the FIRST child links and
   * re-stamps the parent (`markFirstChildIssued` — the race grace runs from
   * here, see `rotationAgeMs`); a grace sibling leaves the parent untouched.
   */
  private async mintChild(
    parent: Pick<
      typeof schema.refreshTokens.$inferSelect,
      'id' | 'userId' | 'familyId' | 'authMethod' | 'userAgent'
    >,
    firstChild = false,
  ) {
    const maxAgeMs = await this.sessionMaxAgeMs();
    const rawToken = generateRawToken();
    const [child] = await this.db
      .insert(schema.refreshTokens)
      .values({
        userId: parent.userId,
        tokenHash: hashToken(rawToken),
        familyId: parent.familyId,
        authMethod: parent.authMethod,
        userAgent: parent.userAgent,
        expiresAt: new Date(Date.now() + maxAgeMs),
      })
      .returning({ id: schema.refreshTokens.id });
    const childId = defined(child, 'inserted child refresh token row').id;
    if (firstChild) await markFirstChildIssued(this.db, parent.id, childId);
    const { userId, familyId } = parent;
    return { rawToken, maxAgeMs, userId, familyId };
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
    const existing = await findReplayCandidate(this.db, tokenHash);
    if (!existing) return null;
    if (existing.revokedAt) return null;
    if (existing.rotatedAgoMs == null) return null;
    const rotatedAgoMs = rotationAgeMs({
      rotatedAgoMs: existing.rotatedAgoMs,
      replacedBy: existing.replacedBy,
    });
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
