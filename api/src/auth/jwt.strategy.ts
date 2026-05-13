import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getCachedAuthUser, setCachedAuthUser } from './auth-user-cache';
import { TokenBlocklistService } from './token-blocklist.service';

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
    if (cached) return buildAuthResult(payload, cached);
    const user = await this.loadAuthUser(payload.sub);
    setCachedAuthUser(payload.sub, user);
    return buildAuthResult(payload, user);
  }

  private async loadAuthUser(userId: number) {
    const [user] = await this.db
      .select({
        role: schema.users.role,
        discordId: schema.users.discordId,
        deactivatedAt: schema.users.deactivatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return user;
  }
}

function buildAuthResult(
  payload: JwtPayload,
  user: { role: string; discordId: string | null; deactivatedAt: Date | null },
) {
  return {
    id: payload.sub,
    username: payload.username,
    role: user.role,
    discordId: user.discordId,
    deactivatedAt: user.deactivatedAt,
    impersonatedBy: payload.impersonatedBy || null,
  };
}
