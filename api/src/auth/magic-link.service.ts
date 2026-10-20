import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UserRole } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { UsersService } from '../users/users.service';
import { assertKickCooldownOrClear } from './auth-status.helpers';
import { signPurposeJwt, verifyPurposeJwt } from './purpose-jwt.helpers';
import { consumeTokenOnce } from './single-use-token.helpers';

/** One body for every redeem failure — no oracle (ROK-1366 AC4). */
export const INVALID_MAGIC_LINK_MESSAGE = 'Invalid or expired sign-in link';

interface MagicLinkPayload {
  sub: number;
  magicLink: true;
  iat: number;
  /** ROK-1823 D11: the user's token version at mint. Optional in the shape so
   * a claimless link is still CONSUMED before `redeem` refuses it. */
  tv?: number;
}

/** The user a redeemed link signs in, shaped for `AuthService.login`. */
export interface MagicLinkUser {
  id: number;
  username: string;
  role: UserRole;
}

function invalidLink(): UnauthorizedException {
  return new UnauthorizedException(INVALID_MAGIC_LINK_MESSAGE);
}

/**
 * One-time sign-in links for Discord -> web transitions (ROK-657, ROK-1366).
 *
 * The token is signed with the `magic-link` purpose secret (purpose-jwt
 * helpers), so it is never a bearer: the JwtStrategy, WS gateways and OAuth
 * hops all verify with JWT_SECRET and reject it. The web reads it from the URL
 * fragment and exchanges it once via POST /auth/redeem-magic-link.
 */
@Injectable()
export class MagicLinkService {
  constructor(
    @Inject(JwtService) private jwtService: JwtService,
    @Inject(UsersService) private usersService: UsersService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Build `<clientUrl><path>#token=<jwt>` (15m, `{sub, magicLink:true, tv}`), or
   * null when the user does not exist. The fragment never reaches a server.
   */
  async generateLink(
    userId: number,
    path: string,
    clientUrl: string,
  ): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    if (!user) return null;
    const token = signPurposeJwt(
      this.jwtService,
      'magic-link',
      { sub: user.id, magicLink: true, tv: user.tokenVersion },
      '15m',
    );
    const url = new URL(path, clientUrl);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }

  /**
   * Exchange a link token for its user, exactly once. D6: the token is
   * consumed BEFORE any user check, so a replay is always a 401. ROK-1823
   * D11: a link whose `tv` is missing or no longer the user's version (minted
   * before a password/role change) is refused. Deactivated users are not
   * refused here — like Discord login, NotDeactivatedGuard gates them per route.
   */
  async redeem(token: string): Promise<MagicLinkUser> {
    const payload = this.verify(token);
    if (!(await consumeTokenOnce(this.db, token))) throw invalidLink();
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.bannedAt) throw invalidLink();
    if (payload.tv !== user.tokenVersion) throw invalidLink();
    await assertKickCooldownOrClear(this.db, user).catch(() => {
      throw invalidLink();
    });
    return { id: user.id, username: user.username, role: user.role };
  }

  private verify(token: string): MagicLinkPayload {
    let payload: Partial<MagicLinkPayload>;
    try {
      payload = verifyPurposeJwt(this.jwtService, 'magic-link', token);
    } catch {
      throw invalidLink();
    }
    const ok =
      payload.magicLink === true &&
      typeof payload.sub === 'number' &&
      typeof payload.iat === 'number';
    if (!ok) throw invalidLink();
    return payload as MagicLinkPayload;
  }
}
