import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { RefreshTokenService } from './refresh-token.service';
import {
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
} from './refresh-cookie.helpers';
import { hashToken } from './refresh-token.helpers';
import { SameOriginCookiePostGuard } from './same-origin-cookie-post.guard';
import { ImpersonationSessionService } from '../impersonation/impersonation-session.service';
import { mintRefreshAccessToken } from './refresh-access-token.helpers';

/**
 * ROK-1353: POST /auth/refresh (rotate) + POST /auth/logout (revoke).
 * Neither route is JWT-guarded — they operate on the httpOnly `rl_rt` cookie.
 * ROK-1755: both reject cross-site callers (Sec-Fetch-Site / Origin) with 403
 * before touching the cookie, whatever the CORS mode.
 */
@Controller('auth')
export class RefreshTokenController {
  constructor(
    private readonly refreshService: RefreshTokenService,
    private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly impersonation: ImpersonationSessionService,
  ) {}

  /**
   * Rotate the refresh cookie → fresh access JWT + new cookie. ROK-1754: the
   * JWT impersonates while the family's marker is live (§3.4.4). Codex r3:
   * the rotated cookie is set only AFTER the access token is minted; a
   * concurrent revoke + block (null mint) 401s with NO cookie mutation, so a
   * late rejection can never delete a cookie a parallel password change just
   * installed.
   */
  @RateLimit('refresh')
  @Post('refresh')
  @UseGuards(SameOriginCookiePostGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const rawToken = readRefreshCookie(req);
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const rotated = await this.refreshService.rotate(rawToken);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    const access_token = await mintRefreshAccessToken(
      {
        db: this.db,
        jwt: this.jwtService,
        impersonation: this.impersonation,
      },
      rotated,
    );
    if (!access_token) throw new UnauthorizedException('Invalid refresh token');
    setRefreshCookie(res, rotated.rawToken, rotated.maxAgeMs);
    return { access_token };
  }

  /** Revoke the presented family + clear cookie (this device only). */
  @Post('logout')
  @UseGuards(SameOriginCookiePostGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const rawToken = readRefreshCookie(req);
    if (rawToken) await this.revokePresented(rawToken);
    clearRefreshCookie(res);
    return { success: true };
  }

  /**
   * Revoke the family the presented token belongs to (this device's session).
   *
   * Deliberately does NOT bump the token version (ROK-1353, ROK-1823): the
   * version is per user and kills the access token on EVERY device, which is
   * wrong for a routine single-device logout and — because smoke tests share
   * one admin account across parallel workers — poisons every concurrent
   * worker's cached token ("Token has been revoked" 401s). The long-lived
   * credential (refresh family) is revoked immediately per AC; the ≤1h access
   * token expires naturally and cannot be renewed. Deactivation does not bump
   * either: it is reversible (ROK-1753) and enforced per request by the
   * strategy's deactivated check.
   */
  private async revokePresented(rawToken: string): Promise<void> {
    const row = await this.refreshService.findActiveByHash(hashToken(rawToken));
    if (!row) return;
    // ROK-1754: revoke first; the marker ends inside with reason `logout`.
    await this.refreshService.revokeFamily(row.familyId, 'logout');
  }
}
