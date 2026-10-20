import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import {
  authUserEpoch,
  getCachedAuthUser,
  setCachedAuthUser,
} from './auth-user-cache';
import {
  suspendedMessage,
  kickCooldownMessage,
  isKickExpired,
  deactivatedException,
} from './auth-status.helpers';

interface JwtPayload {
  sub: number;
  username: string;
  iat: number;
  impersonatedBy?: number | null;
  magicLink?: boolean;
  /** ROK-1823 D2: the sub's token version at mint — required. */
  tv: number;
  /** ROK-1823 D2: the impersonator's version — required with impersonatedBy. */
  itv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    assertSessionPayload(payload);
    const user = await this.authUser(payload.sub);
    assertTokenVersion(payload.tv, user.tokenVersion);
    assertAuthUserActive(user, payload);
    await this.assertImpersonatorActive(payload);
    return buildAuthResult(payload, user);
  }

  /**
   * ROK-1754 §3.4.5 (L13): an impersonation token is renewable, and its `sub`
   * is the TARGET, so the checks above never see the admin. Revoke it on the
   * next request once the impersonator's token version moved (ROK-1823: role
   * change, password change, delete), or they are banned, kicked, deactivated,
   * or no longer an operator/admin.
   */
  private async assertImpersonatorActive(payload: JwtPayload): Promise<void> {
    const adminId = payload.impersonatedBy;
    if (!adminId) return;
    const admin = await this.authUser(adminId);
    assertTokenVersion(payload.itv, admin.tokenVersion);
    assertAuthUserActive(admin, {});
    if (admin.role !== 'operator' && admin.role !== 'admin') {
      throw new UnauthorizedException('Impersonation has ended');
    }
  }

  /** ROK-1823 D9: the epoch is captured BEFORE the load (stale-cache guard). */
  private async authUser(userId: number) {
    const cached = getCachedAuthUser(userId);
    if (cached) return cached;
    const epoch = authUserEpoch(userId);
    const user = await this.loadAuthUser(userId);
    setCachedAuthUser(userId, user, epoch);
    return user;
  }

  private async loadAuthUser(userId: number) {
    const [user] = await this.db
      .select({
        role: schema.users.role,
        discordId: schema.users.discordId,
        deactivatedAt: schema.users.deactivatedAt,
        kickedAt: schema.users.kickedAt,
        bannedAt: schema.users.bannedAt,
        banReason: schema.users.banReason,
        tokenVersion: schema.users.tokenVersion,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}

/**
 * Shape gate before any lookup. ROK-1366 D2: a magic link is redeemed once,
 * never used as a bearer — covers links signed with JWT_SECRET before the
 * purpose-secret switch. ROK-1764: passport-jwt accepts ANY token signed with
 * JWT_SECRET (e.g. the deferred-signup intent token, which has no `sub`), so
 * a `sub` that is not a positive integer is a 401 — never a users query.
 */
/** `users.id` is a serial (int4); a larger sub would 500 the lookup. */
const INT4_MAX = 2_147_483_647;
const REVOKED_MESSAGE = 'Token has been revoked';

function assertSessionPayload(payload: JwtPayload): void {
  if (payload.magicLink) {
    throw new UnauthorizedException('Magic-link tokens are not session tokens');
  }
  const sub: unknown = payload.sub;
  const isUserId =
    typeof sub === 'number' &&
    Number.isInteger(sub) &&
    sub > 0 &&
    sub <= INT4_MAX;
  if (!isUserId) {
    throw new UnauthorizedException('Invalid session token');
  }
  // ROK-1823 D2/D3: a token minted before the version claim (or a forged
  // shape) is a 401 before any lookup — the SPA refreshes into a `tv` token.
  const itvRequired = Boolean(payload.impersonatedBy);
  if (
    !isTokenVersion(payload.tv) ||
    (itvRequired && !isTokenVersion(payload.itv))
  ) {
    throw new UnauthorizedException(REVOKED_MESSAGE);
  }
}

/** `users.token_version` is a non-negative integer; anything else is forged. */
function isTokenVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * ROK-1823 D2: exact match against the cached row — a bump (password change,
 * role change, refresh reuse, delete) kills every token minted before it, and
 * a version rolled BACK (DB restore) fails closed too.
 */
function assertTokenVersion(claim: number | undefined, current: number): void {
  if (claim !== current) throw new UnauthorizedException(REVOKED_MESSAGE);
}

/**
 * Per-request lockout for banned/kicked/deactivated users (§9.2, ROK-1753).
 * Throws 401 — NOT 403 — so the SPA runs its refresh→logout→/login cycle
 * where the reason renders. Read-only: no cache write / no kick auto-clear
 * here (the clear happens at the next login via `assertKickCooldownOrClear`).
 * An admin impersonating a deactivated user is let through, matching
 * NotDeactivatedGuard's impersonation bypass; ban/kick still apply.
 */
function assertAuthUserActive(
  user: {
    bannedAt: Date | null;
    banReason: string | null;
    kickedAt: Date | null;
    deactivatedAt: Date | null;
  },
  payload: Pick<JwtPayload, 'impersonatedBy'>,
): void {
  if (user.bannedAt) {
    throw new UnauthorizedException(suspendedMessage(user.banReason));
  }
  if (user.kickedAt && !isKickExpired(user.kickedAt)) {
    throw new UnauthorizedException(kickCooldownMessage(user.kickedAt));
  }
  if (user.deactivatedAt && !payload.impersonatedBy) {
    throw deactivatedException();
  }
}

function buildAuthResult(
  payload: JwtPayload,
  user: {
    role: string;
    discordId: string | null;
    deactivatedAt: Date | null;
    kickedAt: Date | null;
    bannedAt: Date | null;
    banReason: string | null;
    tokenVersion: number;
  },
) {
  return {
    id: payload.sub,
    username: payload.username,
    role: user.role,
    discordId: user.discordId,
    deactivatedAt: user.deactivatedAt,
    kickedAt: user.kickedAt,
    bannedAt: user.bannedAt,
    banReason: user.banReason,
    impersonatedBy: payload.impersonatedBy || null,
    // ROK-1823 D6: the version that authenticated this request (validated
    // equal to the row's by assertTokenVersion).
    tokenVersion: payload.tv,
  };
}
