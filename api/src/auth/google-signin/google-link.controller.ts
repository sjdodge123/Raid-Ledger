/**
 * ROK-2371 §2: the signed-in Profile "Link Google" routes. Every route 404s
 * while the admin toggle is off or the Google client is unset (AC1).
 *
 * - `POST /auth/google/link/start` (JWT, body `{}`) → single-use nonce +
 *   `rl_link_google` cookie (ROK-1630 pattern, mirrors `startDiscordLink`).
 * - `GET /auth/google/link?nonce=` → 302 Google with a signed `link` state.
 * - `GET /auth/google/link/callback` → link, then 302 to
 *   `/profile/integrations?linked=success|error&provider=google`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import {
  LinkStartRequestSchema,
  type LinkStartResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { setNoStoreLinkHeaders } from '../../steam/steam-link-headers.helpers';
import {
  LINK_REQUEST_EXPIRED_MESSAGE,
  LinkNonceService,
} from '../link-nonce.service';
import {
  consumeBrowserBoundNonce,
  setLinkNonceCookie,
} from '../link-nonce-cookie.helpers';
import type { AuthenticatedExpressRequest } from '../types';
import type { GoogleClient } from '../../calendar-sync/providers/google/google-oauth.helpers';
import { GoogleSigninService } from './google-signin.service';
import { GoogleLinkService } from './google-link.service';

@Controller('auth')
export class GoogleLinkController {
  constructor(
    private readonly svc: GoogleSigninService,
    private readonly link: GoogleLinkService,
    private readonly linkNonceService: LinkNonceService,
  ) {}

  private async clientOr404(): Promise<GoogleClient> {
    const client = await this.svc.getClient();
    if (!client) throw new NotFoundException();
    return client;
  }

  /** POST /auth/google/link/start — body `{}` (a `token` field is a 400). */
  @RateLimit('auth')
  @Post('google/link/start')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async start(
    @Req() req: AuthenticatedExpressRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LinkStartResponseDto> {
    await this.clientOr404();
    const parsed = LinkStartRequestSchema.safeParse(body ?? {});
    if (!parsed.success || parsed.data.returnTo !== undefined) {
      throw new BadRequestException('Invalid request body');
    }
    setNoStoreLinkHeaders(res); // the body carries the nonce
    const minted = this.linkNonceService.mint('google', req.user.id);
    setLinkNonceCookie(res, 'google', minted.nonce);
    return minted;
  }

  /** GET /auth/google/link?nonce= — bound to the minting browser's cookie. */
  @RateLimit('auth')
  @Get('google/link')
  async hop(
    @Query('nonce') nonce: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const client = await this.clientOr404();
    const base = await this.svc.clientUrl();
    const claims = await consumeBrowserBoundNonce(
      this.linkNonceService,
      'google',
      typeof nonce === 'string' ? nonce : undefined,
      req,
      res,
    );
    if (!claims) {
      res.redirect(this.link.resultUrl(base, LINK_REQUEST_EXPIRED_MESSAGE));
      return;
    }
    const redirectUri = await this.svc.redirectUri('link');
    res.redirect(
      this.link.authorizeUrl(res, client, redirectUri, claims.userId),
    );
  }

  /** GET /auth/google/link/callback — state + cookie checked before exchange. */
  @RateLimit('auth')
  @Get('google/link/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
  ): Promise<void> {
    const client = await this.clientOr404();
    res.redirect(
      await this.link.handleCallback(req, res, client, { code, state }),
    );
  }
}
