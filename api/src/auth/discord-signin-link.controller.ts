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
import { setRefreshCookie } from './refresh/refresh-cookie.helpers';

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
    const issued = await this.refreshService.issueAtTokenVersion(
      user.id,
      user.tokenVersion,
      {
        authMethod: 'discord-link',
        userAgent: req.headers['user-agent'] ?? null,
      },
    );
    if (!issued) throw new UnauthorizedException(INVALID_DISCORD_LINK_MESSAGE);
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
    return this.authService.login(user, user.tokenVersion);
  }
}
