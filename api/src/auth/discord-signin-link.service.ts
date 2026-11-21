import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { AuthService } from './auth.service';
import {
  buildFragmentLink,
  parseDiscordSigninClaims,
  SIGNIN_LINK_PATH,
  SIGNIN_LINK_TTL,
  type CommandLinkSrc,
  type DiscordSigninClaims,
} from './discord-signin-link.helpers';
import type { MagicLinkUser } from './magic-link.service';
import { signPurposeJwt, verifyPurposeJwt } from './purpose-jwt.helpers';
import { consumeTokenOnce } from './single-use-token.helpers';
import { readTokenVersion } from './token-version.helpers';

/** One body for every redeem failure — no oracle (mirrors ROK-1366 AC4). */
export const INVALID_DISCORD_LINK_MESSAGE = 'Invalid or expired sign-in link';

/** What the `/login` command knows about a first-time member. */
export interface DiscordSigninMintInput extends DiscordSigninClaims {
  src: CommandLinkSrc;
}

function invalidLink(): UnauthorizedException {
  return new UnauthorizedException(INVALID_DISCORD_LINK_MESSAGE);
}

/**
 * ROK-2283: one-time sign-in links for a guild member with no Raid Ledger
 * account yet (Q3a — the account is created when the link is redeemed).
 *
 * Signed with the `discord-signin` purpose secret, so it is never a bearer and
 * never a magic link. Redeem consumes the token FIRST, then runs the same
 * `validateDiscordUser` an OAuth sign-in runs: ban/kick refusal, relink of an
 * `unlinked:<id>` row, create-or-update, and AUTH_EVENTS.DISCORD_LOGIN.
 */
@Injectable()
export class DiscordSigninLinkService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Build `<clientUrl>/signin-link#token=<jwt>` (15m, single use). */
  mint(input: DiscordSigninMintInput, clientUrl: string): string {
    const token = signPurposeJwt(
      this.jwtService,
      'discord-signin',
      {
        discordId: input.discordId,
        username: input.username,
        avatar: input.avatar,
        signin: true,
        src: input.src,
      },
      SIGNIN_LINK_TTL,
    );
    return buildFragmentLink(clientUrl, SIGNIN_LINK_PATH, token);
  }

  /** Exchange a token for its (possibly new) user, exactly once. */
  async redeem(token: string): Promise<MagicLinkUser> {
    const claims = this.verify(token);
    if (!(await consumeTokenOnce(this.db, token))) throw invalidLink();
    const user = await this.authService
      .validateDiscordUser(claims.discordId, claims.username, claims.avatar)
      .catch(() => {
        throw invalidLink();
      });
    if (!user) throw invalidLink();
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: await readTokenVersion(this.db, user.id),
    };
  }

  private verify(token: string): DiscordSigninClaims {
    let payload: Record<string, unknown>;
    try {
      payload = verifyPurposeJwt(this.jwtService, 'discord-signin', token);
    } catch {
      throw invalidLink();
    }
    const claims = parseDiscordSigninClaims(payload);
    if (!claims) throw invalidLink();
    return claims;
  }
}
