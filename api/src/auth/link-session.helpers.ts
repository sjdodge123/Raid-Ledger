import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TokenResponseDto } from '@raid-ledger/contract';
import type { AuthService } from './auth.service';
import type { MagicLinkUser } from './magic-link.service';
import type { RefreshTokenService } from './refresh/refresh-token.service';
import { setRefreshCookie } from './refresh/refresh-cookie.helpers';

/** The services a link-redeem route needs to turn a user into a session. */
export interface LinkSessionDeps {
  authService: AuthService;
  refreshService: RefreshTokenService;
}

/** How the session was earned — stored on the refresh family. */
export type LinkAuthMethod = 'magic' | 'discord-link';

/**
 * ROK-2370: the shared tail of /auth/redeem-magic-link,
 * /auth/redeem-discord-link and the sign-in code poll. Mints a refresh family
 * bound to the token version `redeem` checked (ROK-1823 review P3), sets the
 * refresh cookie, emits DISCORD_LOGIN for a `/login` magic link (ROK-2283),
 * and returns the access token. A version bump since redeem → the 401.
 */
export async function issueLinkSession(
  deps: LinkSessionDeps,
  user: MagicLinkUser,
  authMethod: LinkAuthMethod,
  invalidMessage: string,
  req: Request,
  res: Response,
): Promise<TokenResponseDto> {
  const issued = await deps.refreshService.issueAtTokenVersion(
    user.id,
    user.tokenVersion,
    { authMethod, userAgent: req.headers['user-agent'] ?? null },
  );
  if (!issued) throw new UnauthorizedException(invalidMessage);
  setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
  if (user.commandDiscordId !== undefined) {
    deps.authService.emitDiscordLogin(user.id, user.commandDiscordId);
  }
  return deps.authService.login(user, user.tokenVersion);
}
