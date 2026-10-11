import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request as ExpressRequest, Response } from 'express';
import { LocalAuthService } from './local-auth.service';
import { OperatorGuard } from './operator.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { RefreshTokenService } from './refresh/refresh-token.service';
import {
  readRefreshCookie,
  setRefreshCookie,
} from './refresh/refresh-cookie.helpers';
import { hashToken } from './refresh/refresh-token.helpers';
import { SameOriginCookiePostGuard } from './refresh/same-origin-cookie-post.guard';
import { ImpersonationSessionService } from './impersonation/impersonation-session.service';
import { z } from 'zod';

// Email regex that accepts local emails (admin@local) and standard emails
const emailRegex = /^[^\s@]+@[^\s@]+$/;

// Accept either 'email' or 'username' field for backwards compatibility
const LocalLoginSchema = z
  .object({
    email: z.string().regex(emailRegex, 'Invalid email format').optional(),
    username: z
      .string()
      .regex(emailRegex, 'Invalid username format')
      .optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((data) => data.email || data.username, {
    message: 'Email or username is required',
  });

type LocalLoginDto = z.infer<typeof LocalLoginSchema>;

import type { AuthenticatedRequest } from './types';

@Controller('auth')
export class LocalAuthController {
  constructor(
    private localAuthService: LocalAuthService,
    private refreshService: RefreshTokenService,
    private sessions: ImpersonationSessionService,
  ) {}

  /**
   * POST /auth/local
   * Authenticate with email/password or username/password credentials.
   * Accepts either 'email' or 'username' field for backwards compatibility.
   * ROK-1353: also mints a refresh family + sets the httpOnly `rl_rt` cookie.
   */
  @RateLimit('auth')
  @Post('local')
  @HttpCode(HttpStatus.OK)
  async localLogin(
    @Body() body: LocalLoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Validate request body
    const result = LocalLoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Use email if provided, otherwise username (both are email format)
    const email = result.data.email || result.data.username!;
    const { password } = result.data;

    // Validate credentials and get user
    const user = await this.localAuthService.validateCredentials(
      email,
      password,
    );

    const issued = await this.refreshService.issue(user.id, {
      authMethod: 'local',
      userAgent: req.headers['user-agent'] ?? null,
    });
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);

    // Generate JWT
    return this.localAuthService.login(user);
  }

  /**
   * POST /auth/impersonate/exit — ROK-1754. Declared ABOVE `impersonate/:userId`
   * (Express matches in registration order; below it, `exit` hit ParseIntPipe
   * → 400). Cookie-authenticated like /auth/logout, NOT JWT: an admin whose
   * impersonation token already 401s can still exit. Ending only drops
   * privilege, and it is idempotent (audits once).
   */
  @Post('impersonate/exit')
  @UseGuards(SameOriginCookiePostGuard)
  @HttpCode(HttpStatus.OK)
  async exitImpersonation(
    @Req() req: ExpressRequest,
  ): Promise<{ success: boolean }> {
    const familyId = await this.callerFamilyId(req);
    if (familyId) await this.sessions.end(familyId, 'user_exit');
    return { success: true };
  }

  /**
   * POST /auth/impersonate/:userId
   * Operator+. Issue a JWT as the target user for testing/debugging. With the
   * `rl_rt` cookie the impersonation is bound to that refresh family
   * (survives reload); the cookie must belong to the bearer (403 otherwise).
   */
  @Post('impersonate/:userId')
  @UseGuards(AuthGuard('jwt'), OperatorGuard)
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseIntPipe) userId: number,
    @Request() req: AuthenticatedRequest & ExpressRequest,
  ) {
    const familyId = await this.callerFamilyId(req, req.user.id);
    return this.localAuthService.impersonate(req.user, userId, familyId);
  }

  /**
   * The live refresh family behind the request's `rl_rt` cookie, or null
   * when there is none. With `mustBelongTo`, a cookie that is dead or owned
   * by someone else is a 403 `session_mismatch`.
   */
  private async callerFamilyId(
    req: ExpressRequest,
    mustBelongTo?: number,
  ): Promise<string | null> {
    const raw = readRefreshCookie(req);
    if (!raw) return null;
    const row = await this.refreshService.findActiveByHash(hashToken(raw));
    const live =
      row && !row.revokedAt && row.expiresAt > new Date() ? row : null;
    if (mustBelongTo !== undefined && live?.userId !== mustBelongTo)
      throw new ForbiddenException('session_mismatch');
    return live?.familyId ?? null;
  }

  /**
   * GET /auth/users
   * Operator+. List non-admin users for the impersonation dropdown.
   */
  @Get('users')
  @UseGuards(AuthGuard('jwt'), OperatorGuard)
  async listUsers() {
    return this.localAuthService.listNonAdminUsers();
  }
}
