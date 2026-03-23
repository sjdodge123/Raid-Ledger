import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { getCachedAuthUser, setCachedAuthUser } from './auth-user-cache';

interface JwtPayload {
  sub: number;
  username: string;
  impersonatedBy?: number | null;
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
    const cached = getCachedAuthUser(payload.sub);
    if (cached) {
      return buildAuthResult(payload, cached.role, cached.discordId);
    }
    const [user] = await this.db
      .select({ role: schema.users.role, discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1);
    if (!user) throw new UnauthorizedException('User no longer exists');
    setCachedAuthUser(payload.sub, {
      role: user.role,
      discordId: user.discordId,
    });
    return buildAuthResult(payload, user.role, user.discordId);
  }
}

function buildAuthResult(
  payload: JwtPayload,
  role: string,
  discordId: string | null,
) {
  return {
    id: payload.sub,
    username: payload.username,
    role,
    discordId,
    impersonatedBy: payload.impersonatedBy || null,
  };
}
