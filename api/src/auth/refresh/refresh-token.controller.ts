import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
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

/**
 * ROK-1353: POST /auth/refresh (rotate) + POST /auth/logout (revoke).
 * Neither route is JWT-guarded — they operate on the httpOnly `rl_rt` cookie.
 */
@Controller('auth')
export class RefreshTokenController {
  constructor(
    private readonly refreshService: RefreshTokenService,
    private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Rotate the refresh cookie → fresh 1h access JWT + new cookie. */
  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const rawToken = readRefreshCookie(req);
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const rotated = await this.refreshService.rotate(rawToken);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    setRefreshCookie(res, rotated.rawToken, rotated.maxAgeMs);
    const access_token = await this.signAccessToken(rotated.userId);
    return { access_token };
  }

  /** Revoke the presented family + clear cookie (this device only). */
  @Post('logout')
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
   * Deliberately does NOT `blockUser` (ROK-1353): blocklist is keyed on userId
   * and kills the access token on EVERY device, which is wrong for a routine
   * single-device logout and — because smoke tests share one admin account
   * across parallel workers — poisons every concurrent worker's cached token
   * ("Token has been revoked" 401s). The long-lived credential (refresh
   * family) is revoked immediately per AC; the ≤1h access token expires
   * naturally and cannot be renewed. blockUser stays on deactivation, the
   * security event that SHOULD terminate all devices.
   */
  private async revokePresented(rawToken: string): Promise<void> {
    const row = await this.refreshService.findActiveByHash(hashToken(rawToken));
    if (!row) return;
    await this.refreshService.revokeFamily(row.familyId);
  }

  /** Mint a fresh 1h access JWT for the user behind a rotated token. */
  private async signAccessToken(userId: number): Promise<string> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('User not found');
    return this.jwtService.sign({
      username: user.username,
      sub: user.id,
      role: user.role,
    });
  }
}
