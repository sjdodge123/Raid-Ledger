/**
 * ROK-2371 D1(a): `GET /auth/discord/pending-link` — the `/auth/first-time`
 * page's "I already have an account — sign in with Discord" for a parked
 * GOOGLE identity. Starts a browser-bound Discord login with
 * `action:'pending-link'`; the login callback completes it
 * (`DiscordPendingIdentityService.route`). No parked Google identity in this
 * browser (or Google sign-in off) → back to the choice with `error=expired`.
 */
import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { SettingsService } from '../../settings/settings.service';
import { DiscordPendingIdentityService } from '../../auth/google-signin/discord-pending-identity.service';
import { getOriginUrl } from './discord-auth.helpers';
import { signBrowserBoundLoginState } from './discord-login-state.helpers';

@Controller('auth')
export class DiscordPendingLinkController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly configService: ConfigService,
    private readonly pendingIdentity: DiscordPendingIdentityService,
  ) {}

  @RateLimit('auth')
  @Get('discord/pending-link')
  async start(@Req() req: Request, @Res() res: Response): Promise<void> {
    const clientUrl =
      this.configService.get<string>('CLIENT_URL') || getOriginUrl(req);
    const secret = this.configService.get<string>('JWT_SECRET');
    const oauth = await this.settingsService.getDiscordOAuthConfig();
    if (
      !oauth ||
      !secret ||
      !(await this.pendingIdentity.hasPendingGoogle(req))
    ) {
      res.redirect(`${clientUrl}/auth/first-time?error=expired`);
      return;
    }
    const state = signBrowserBoundLoginState(
      req,
      res,
      { action: 'pending-link' },
      secret,
    );
    res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${oauth.clientId}&redirect_uri=${encodeURIComponent(oauth.callbackUrl)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`,
    );
  }
}
