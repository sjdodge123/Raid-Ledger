import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
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
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  validate(payload: JwtPayload) {
    // Backward compat: derive role from legacy isAdmin boolean
    const role: UserRole =
      payload.role ?? (payload.isAdmin ? 'admin' : 'member');

    return {
      id: payload.sub,
      username: payload.username,
      role,
      impersonatedBy: payload.impersonatedBy || null,
    };
  }
}
