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
import { TokenBlocklistService } from '../token-blocklist.service';
import {
  REFRESH_COOKIE_NAME,
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
    private readonly blocklist: TokenBlocklistService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Rotate the refresh cookie → fresh 1h access JWT + new cookie. */
  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const rawToken = this.readCookie(req);
    if (!rawToken) throw new UnauthorizedException('No refresh token');
    const rotated = await this.refreshService.rotate(rawToken);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    setRefreshCookie(res, rotated.rawToken, rotated.maxAgeMs);
    const access_token = await this.signAccessToken(rotated.userId);
    return { access_token };
  }

  /** Revoke the presented family + blocklist + clear cookie. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const rawToken = this.readCookie(req);
    if (rawToken) await this.revokePresented(rawToken);
    clearRefreshCookie(res);
    return { success: true };
  }

  /** Read the raw `rl_rt` cookie value (cookie-parser populates req.cookies). */
  private readCookie(req: Request): string | null {
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const value = cookies[REFRESH_COOKIE_NAME];
    return typeof value === 'string' ? value : null;
  }

  /** Revoke the family the presented token belongs to + blocklist the user. */
  private async revokePresented(rawToken: string): Promise<void> {
    const row = await this.refreshService.findActiveByHash(hashToken(rawToken));
    if (!row) return;
    await this.refreshService.revokeFamily(row.familyId);
    await this.blocklist.blockUser(row.userId);
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
