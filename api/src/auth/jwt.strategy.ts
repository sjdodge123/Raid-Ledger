import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { UserRole } from '@raid-ledger/contract';

interface JwtPayload {
  sub: number;
  username: string;
  role?: UserRole;
  /** @deprecated Pre-ROK-272 tokens used isAdmin boolean */
  isAdmin?: boolean;
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
    // Re-fetch role from database to prevent privilege persistence after role changes.
    // Falls back to JWT claim if user is not found (e.g., deleted user).
    let role: UserRole = payload.role ?? (payload.isAdmin ? 'admin' : 'member');

    const [user] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1);

    if (user) {
      role = user.role;
    }

    return {
      id: payload.sub,
      username: payload.username,
      role,
      impersonatedBy: payload.impersonatedBy || null,
    };
  }
}
