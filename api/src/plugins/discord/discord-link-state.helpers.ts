import type { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { verifyOAuthState } from './discord-auth.helpers';
import { assertLinkStateBoundToBrowser } from '../../auth/link-state-cookie.helpers';

/**
 * GET /auth/discord/link/callback: verify the signed `link` state AND that it
 * comes back to the browser the GET /link hop bound it to (ROK-1366), so a
 * forwarded authorize URL cannot link the clicker's Discord into the
 * sender's account. Returns the state's userId.
 */
export function verifyDiscordLinkState(
  state: string,
  secret: string,
  logger: Logger,
  { req, res }: { req: Request; res: Response },
): number {
  const stateData = verifyOAuthState(state, secret, logger);
  if (!stateData || stateData.action !== 'link')
    throw new Error('Invalid or tampered state parameter');
  assertLinkStateBoundToBrowser(req, res, 'discord', stateData.r);
  return stateData.userId as number;
}
