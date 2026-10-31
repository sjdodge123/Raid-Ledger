/**
 * ROK-1701: `POST /setup/claim` — public. A valid setup code sets the
 * admin@local password, consumes the claim and signs the caller in exactly
 * like `POST /auth/local` (refresh cookie + access token).
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SetupClaimRequestSchema } from '@raid-ledger/contract';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { LocalAuthService } from '../auth/local-auth.service';
import { RefreshTokenService } from '../auth/refresh/refresh-token.service';
import { setRefreshCookie } from '../auth/refresh/refresh-cookie.helpers';
import { getRequestOrigin } from '../common/request-origin.helpers';
import { SetupClaimService, type ClaimAttempt } from './setup-claim.service';
import { SetupClaimException, retryAfterSeconds } from './setup-claim.errors';

/** D-12: the forwarded protocol, not `req.secure` (TRUST_PROXY-dependent). */
function requestProtocol(req: Request): 'http' | 'https' {
  return getRequestOrigin(req).startsWith('https://') ? 'https' : 'http';
}

@Controller('setup')
export class SetupClaimController {
  constructor(
    private readonly claims: SetupClaimService,
    private readonly localAuthService: LocalAuthService,
    private readonly refreshService: RefreshTokenService,
  ) {}

  @RateLimit('auth')
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = SetupClaimRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        'A setup code and a password of at least 12 characters are required.',
      );
    }
    const user = await this.attempt(
      { ...parsed.data, protocol: requestProtocol(req) },
      res,
    );
    const issued = await this.refreshService.issue(user.id, {
      authMethod: 'local',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
    return this.localAuthService.login(user);
  }

  /** Run the claim; a soft-lock refusal also gets a `Retry-After` header. */
  private async attempt(attempt: ClaimAttempt, res: Response) {
    try {
      return await this.claims.claim(attempt);
    } catch (err) {
      if (err instanceof SetupClaimException && err.retryAt) {
        const seconds = retryAfterSeconds(err.retryAt, new Date());
        res.setHeader('Retry-After', String(seconds));
      }
      throw err;
    }
  }
}
