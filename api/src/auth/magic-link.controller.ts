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
  RedeemMagicLinkSchema,
  type TokenResponseDto,
} from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { AuthService } from './auth.service';
import {
  MagicLinkService,
  INVALID_MAGIC_LINK_MESSAGE,
} from './magic-link.service';
import { RefreshTokenService } from './refresh/refresh-token.service';
import { setRefreshCookie } from './refresh/refresh-cookie.helpers';

/**
 * ROK-1366: exchange a one-time magic-link token (read by the web from the
 * URL fragment) for a session. No JWT guard — the link token is the
 * credential, and it is never a bearer itself.
 */
@Controller('auth')
export class MagicLinkController {
  constructor(
    private readonly magicLinkService: MagicLinkService,
    private readonly authService: AuthService,
    private readonly refreshService: RefreshTokenService,
  ) {}

  /**
   * POST /auth/redeem-magic-link. JSON only (415 otherwise): a cross-site
   * form cannot send JSON, and a cross-site JSON fetch needs a CORS preflight
   * the API refuses — the login-CSRF guard. Every token failure is the same
   * 401 body. Mints a refresh family with auth_method 'magic'.
   */
  @RateLimit('auth')
  @Post('redeem-magic-link')
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
    const parsed = RedeemMagicLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException(INVALID_MAGIC_LINK_MESSAGE);
    }
    const user = await this.magicLinkService.redeem(parsed.data.token);
    const issued = await this.refreshService.issue(user.id, {
      authMethod: 'magic',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
    return this.authService.login(user);
  }
}
