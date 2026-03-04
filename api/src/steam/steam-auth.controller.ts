import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { SteamService } from './steam.service';
import {
  buildSteamOpenIdUrl,
  verifySteamOpenId,
  getPlayerSummary,
} from './steam-http.util';
import type { SteamLinkStatusDto } from '@raid-ledger/contract';
import * as crypto from 'crypto';
import type { Response, Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: { id: number };
}

/**
 * Steam Auth Controller (ROK-417)
 * Handles Steam OpenID 2.0 account linking.
 * Unlike Discord, Steam uses OpenID 2.0 (not OAuth 2.0), so there's no token exchange.
 */
@Controller('auth/steam')
export class SteamAuthController {
  private readonly logger = new Logger(SteamAuthController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly steamService: SteamService,
  ) {}

  /**
   * Sign state parameter to prevent tampering (same pattern as Discord).
   */
  private signState(payload: object): string {
    const data = JSON.stringify(payload);
    const secret = this.configService.get<string>('JWT_SECRET')!;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
    return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
  }

  /**
   * Verify and decode signed state parameter.
   */
  private verifyState(state: string): Record<string, unknown> | null {
    try {
      const { data, signature } = JSON.parse(
        Buffer.from(state, 'base64').toString(),
      ) as { data: string; signature: string };
      const secret = this.configService.get<string>('JWT_SECRET')!;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(data)
        .digest('hex');

      if (
        !crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        )
      ) {
        return null;
      }

      const parsed = JSON.parse(data) as Record<string, unknown>;

      // Enforce 10-minute expiry
      const MAX_STATE_AGE_MS = 10 * 60 * 1000;
      const timestamp = parsed.timestamp as number | undefined;
      if (!timestamp || Date.now() - timestamp > MAX_STATE_AGE_MS) {
        this.logger.warn('Steam OpenID state parameter expired');
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private getClientUrl(req: Request): string {
    return (
      this.configService.get<string>('CLIENT_URL') ||
      `${(req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http'}://${req.headers.host || 'localhost'}`
    );
  }

  private getOriginUrl(req: Request): string {
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
  }

  /**
   * GET /auth/steam/link
   * Initiates Steam OpenID 2.0 linking.
   * Note: Uses JWT token in query param since browser redirects can't send headers.
   */
  @RateLimit('auth')
  @Get('link')
  async steamLink(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const clientUrl = this.getClientUrl(req);

    if (!token) {
      res.status(401).json({ message: 'Authentication token required' });
      return;
    }

    let userId: number;
    try {
      userId = this.jwtService.verify<{ sub: number }>(token).sub;
    } catch {
      res.redirect(
        `${clientUrl}/profile?steam=error&message=${encodeURIComponent('Invalid or expired token. Please try again.')}`,
      );
      return;
    }

    // Check Steam is configured
    const steamConfigured = await this.settingsService.isSteamConfigured();
    if (!steamConfigured) {
      res.redirect(
        `${clientUrl}/profile?steam=error&message=${encodeURIComponent('Steam integration is not configured. Please ask an admin to set it up.')}`,
      );
      return;
    }

    // Create signed state with user ID
    const state = this.signState({
      userId,
      action: 'steam_link',
      timestamp: Date.now(),
    });

    // Build return URL — Steam OpenID returns here after auth
    const originUrl = this.getOriginUrl(req);
    const returnUrl = `${originUrl}/auth/steam/link/callback?state=${encodeURIComponent(state)}`;

    // Redirect to Steam OpenID
    const steamUrl = buildSteamOpenIdUrl(returnUrl);
    res.redirect(steamUrl);
  }

  /**
   * GET /auth/steam/link/callback
   * Handles Steam OpenID 2.0 callback for linking.
   */
  @RateLimit('auth')
  @Get('link/callback')
  async steamLinkCallback(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const clientUrl = this.getClientUrl(req);

    try {
      // Verify signed state
      const state = query.state;
      if (!state) throw new Error('Missing state parameter');

      const stateData = this.verifyState(state);
      if (!stateData || stateData.action !== 'steam_link') {
        throw new Error('Invalid or tampered state parameter');
      }

      const userId = stateData.userId as number;

      // Verify OpenID response with Steam
      const steamId = await verifySteamOpenId(query);
      if (!steamId) {
        throw new Error('Steam verification failed');
      }

      // Link Steam account
      await this.usersService.linkSteam(userId, steamId);

      this.logger.log(`Steam account ${steamId} linked to user ${userId}`);

      // Check privacy status
      const apiKey = await this.settingsService.getSteamApiKey();
      let isPublic = false;
      if (apiKey) {
        const profile = await getPlayerSummary(apiKey, steamId);
        isPublic = profile?.communityvisibilitystate === 3;
      }

      // Auto-trigger library sync (fire-and-forget)
      if (isPublic) {
        this.steamService.syncLibrary(userId).catch((err: unknown) => {
          this.logger.warn(
            `Auto-sync after Steam link failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
      }

      const privacyParam = isPublic ? '' : '&steam_private=true';
      res.redirect(`${clientUrl}/profile?steam=success${privacyParam}`);
    } catch (error) {
      this.logger.error('Steam link error:', error);
      res.redirect(
        `${clientUrl}/profile?steam=error&message=${encodeURIComponent(error instanceof Error ? error.message : 'Steam link failed')}`,
      );
    }
  }

  /**
   * GET /auth/steam/status
   * Get current user's Steam link status.
   */
  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  async steamStatus(
    @Req() req: AuthenticatedRequest,
  ): Promise<SteamLinkStatusDto> {
    const user = await this.usersService.findById(req.user.id);
    if (!user?.steamId) {
      return { linked: false, steamId: null };
    }

    const apiKey = await this.settingsService.getSteamApiKey();
    if (!apiKey) {
      return { linked: true, steamId: user.steamId };
    }

    const profile = await getPlayerSummary(apiKey, user.steamId);
    return {
      linked: true,
      steamId: user.steamId,
      personaName: profile?.personaname ?? null,
      avatarUrl: profile?.avatarmedium ?? null,
      isPublic: profile?.communityvisibilitystate === 3,
    };
  }

  /**
   * POST /auth/steam/sync
   * Manually trigger a Steam library sync for the current user.
   */
  @RateLimit('auth')
  @Post('sync')
  @UseGuards(AuthGuard('jwt'))
  async syncLibrary(@Req() req: AuthenticatedRequest) {
    const result = await this.steamService.syncLibrary(req.user.id);
    return {
      success: true,
      message: `Synced ${result.matched} games (${result.newInterests} new, ${result.updatedPlaytime} updated playtime)`,
      ...result,
    };
  }

  /**
   * DELETE /auth/steam/link
   * Unlink Steam account from current user.
   */
  @Delete('link')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async unlinkSteam(@Req() req: AuthenticatedRequest) {
    await this.usersService.unlinkSteam(req.user.id);
    this.logger.log(`Steam account unlinked for user ${req.user.id}`);
  }
}
