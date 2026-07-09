import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getCachedAuthUser, setCachedAuthUser } from './auth-user-cache';
import { TokenBlocklistService } from './token-blocklist.service';
import {
  suspendedMessage,
  kickCooldownMessage,
  isKickExpired,
} from './auth-status.helpers';

interface JwtPayload {
  sub: number;
  username: string;
  iat: number;
  impersonatedBy?: number | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly tokenBlocklist: TokenBlocklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    if (await this.tokenBlocklist.isBlocked(payload.sub, payload.iat)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    const cached = getCachedAuthUser(payload.sub);
    if (cached) {
      assertAuthUserActive(cached);
      return buildAuthResult(payload, cached);
    }
    const user = await this.loadAuthUser(payload.sub);
    setCachedAuthUser(payload.sub, user);
    assertAuthUserActive(user);
    return buildAuthResult(payload, user);
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
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}

/**
 * Per-request lockout for banned/kicked users (§9.2). Throws 401 — NOT 403 —
 * so the SPA runs its refresh→logout→/login cycle where the suspension reason
 * renders. Read-only: no cache write / no kick auto-clear here (the clear
 * happens at the next login via `assertKickCooldownOrClear`).
 */
function assertAuthUserActive(user: {
  bannedAt: Date | null;
  banReason: string | null;
  kickedAt: Date | null;
}): void {
  if (user.bannedAt) {
    throw new UnauthorizedException(suspendedMessage(user.banReason));
  }
  if (user.kickedAt && !isKickExpired(user.kickedAt)) {
    throw new UnauthorizedException(kickCooldownMessage(user.kickedAt));
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
  };
}
