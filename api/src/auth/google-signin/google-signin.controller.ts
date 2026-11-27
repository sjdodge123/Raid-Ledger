/**
 * ROK-2371: `GET /auth/google` + `GET /auth/google/callback`. Both 404 while
 * the admin toggle is off or the Google client is unset (AC1).
 * The Profile link routes (`/auth/google/link*`) belong to L2c.
 */
import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { browserBoundCookieAttrs } from '../browser-bound-cookie.helpers';
import { bindLinkStateToBrowser } from '../link-state-cookie.helpers';
import {
  buildGoogleSigninUrl,
  GOOGLE_SIGNIN_CALLBACK_PATH,
  googleRedirectUri,
  type GoogleSigninAction,
} from './google-signin-oauth.helpers';
import { GoogleSigninFlowService } from './google-signin-flow.service';
import { GoogleSigninService } from './google-signin.service';
import { PendingIdentityStore } from './pending-identity.store';

@Controller('auth')
export class GoogleSigninController {
  constructor(
    private readonly svc: GoogleSigninService,
    private readonly flow: GoogleSigninFlowService,
    private readonly pending: PendingIdentityStore,
  ) {}

  /**
   * Start a sign-in. `?intent=pending-link` is the D1a "I already have an
   * account" branch for a parked Discord identity in this browser.
   */
  @RateLimit('auth')
  @Get('google')
  async start(
    @Req() req: Request,
    @Res() res: Response,
    @Query('intent') intent?: string,
  ): Promise<void> {
    const client = await this.svc.getClient();
    if (!client) throw new NotFoundException();
    const base = await this.svc.clientUrl();
    const action: GoogleSigninAction =
      intent === 'pending-link' ? 'pending-link' : 'signin';
    if (action === 'pending-link' && !(await this.hasParkedDiscord(req))) {
      res.redirect(`${base}/auth/first-time?error=expired`);
      return;
    }
    const attrs = browserBoundCookieAttrs(req);
    const r = bindLinkStateToBrowser(res, 'google-signin', attrs);
    const { state, n } = this.flow.mintState(action, r);
    res.redirect(
      buildGoogleSigninUrl({
        clientId: client.clientId,
        redirectUri: googleRedirectUri(base, GOOGLE_SIGNIN_CALLBACK_PATH),
        state,
        n,
      }),
    );
  }

  /** D1a pending-link needs a parked Discord identity in this browser. */
  private async hasParkedDiscord(req: Request): Promise<boolean> {
    return (await this.pending.peek(req))?.provider === 'discord';
  }

  @RateLimit('auth')
  @Get('google/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
  ): Promise<void> {
    const client = await this.svc.getClient();
    if (!client) throw new NotFoundException();
    res.redirect(
      await this.flow.handleCallback(req, res, client, { code, state }),
    );
  }
}
