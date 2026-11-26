import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  RedeemDiscordLinkSchema,
  type TokenResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { AuthService } from './auth.service';
import {
  DiscordSigninLinkService,
  INVALID_DISCORD_LINK_MESSAGE,
} from './discord-signin-link.service';
import { RefreshTokenService } from './refresh/refresh-token.service';
import { issueLinkSession } from './link-session.helpers';

/**
 * ROK-2283: exchange a first-time member's `/login` sign-in token for a
 * session, creating the account on first use. No JWT guard — the link token
 * is the credential, and it is never a bearer itself.
 */
@Controller('auth')
export class DiscordSigninLinkController {
  constructor(
    private readonly signinLinkService: DiscordSigninLinkService,
    private readonly authService: AuthService,
    private readonly refreshService: RefreshTokenService,
  ) {}

  /**
   * POST /auth/redeem-discord-link. JSON only (415 otherwise) — the same
   * login-CSRF guard as /auth/redeem-magic-link. Every failure is one 401
   * body. Mints a refresh family with auth_method 'discord-link'.
   */
  @RateLimit('auth')
  @Post('redeem-discord-link')
  @HttpCode(HttpStatus.OK)
  async redeem(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponseDto> {
    if (!req.is('application/json')) {
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json',
      );
    }
    const parsed = RedeemDiscordLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException(INVALID_DISCORD_LINK_MESSAGE);
    }
    const user = await this.signinLinkService.redeem(parsed.data.token);
    // ROK-2370: the session tail is shared with the sign-in code poll.
    return issueLinkSession(
      { authService: this.authService, refreshService: this.refreshService },
      user,
      'discord-link',
      INVALID_DISCORD_LINK_MESSAGE,
      req,
      res,
    );
  }
}
