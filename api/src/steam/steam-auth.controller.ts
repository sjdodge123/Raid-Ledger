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
import * as Sentry from '@sentry/nestjs';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import { validateSteamReturnTo } from './steam-link-returnto.helpers';
import {
  LinkNonceService,
  LINK_REQUEST_EXPIRED_MESSAGE,
} from '../auth/link-nonce.service';
import {
  buildSteamOpenIdUrl,
  verifySteamOpenId,
  getPlayerSummary,
} from './steam-http.util';
import type { SteamLinkStatusDto } from '@raid-ledger/contract';
import * as crypto from 'crypto';
import type { Response, Request } from 'express';
import type { AuthenticatedExpressRequest } from '../auth/types';

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
    private readonly linkNonceService: LinkNonceService,
    private readonly steamService: SteamService,
    private readonly steamWishlistService: SteamWishlistService,
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

  /**
   * Get the externally-reachable API base URL.
   * Behind a reverse proxy (nginx), the API is at `${CLIENT_URL}/api`.
   * In local dev (direct access), the API is at the request origin.
   */
  private getApiBaseUrl(req: Request): string {
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    const isProxied = !!req.headers['x-forwarded-proto'];
    if (clientUrl && isProxied) return `${clientUrl}/api`;
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
  }

  /** Redirect to client with Steam-not-configured error. */
  private redirectSteamNotConfigured(
    res: Response,
    clientUrl: string,
    returnTo: string,
  ): void {
    const msg = encodeURIComponent(
      'Steam integration is not configured. Please ask an admin to set it up.',
    );
    res.redirect(`${clientUrl}${returnTo}?steam=error&message=${msg}`);
  }

  /**
   * GET /auth/steam/link?nonce= — initiates Steam OpenID 2.0 linking. The
   * nonce (POST /auth/steam/link/start, ROK-1630) is single-use and carries
   * the user id + allowlisted returnTo; every miss gets the same error 302.
   */
  @RateLimit('auth')
  @Get('link')
  async steamLink(
    @Query('nonce') nonce: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const clientUrl = this.getClientUrl(req);
    const claims = await this.linkNonceService.consume('steam', nonce);
    if (!claims) {
      const msg = encodeURIComponent(LINK_REQUEST_EXPIRED_MESSAGE);
      res.redirect(
        `${clientUrl}/profile/integrations?steam=error&message=${msg}`,
      );
      return;
    }
    const returnTo = validateSteamReturnTo(claims.returnTo);
    if (!(await this.settingsService.isSteamConfigured())) {
      this.redirectSteamNotConfigured(res, clientUrl, returnTo);
      return;
    }
    const state = this.signState({
      userId: claims.userId,
      action: 'steam_link',
      timestamp: Date.now(),
      returnTo,
    });
    const callbackUrl = `${this.getApiBaseUrl(req)}/auth/steam/link/callback?state=${encodeURIComponent(state)}`;
    res.redirect(buildSteamOpenIdUrl(callbackUrl));
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
    const returnTo = this.extractReturnToFromState(query.state);
    try {
      const { userId, steamId } = await this.processLinkCallback(query);
      const isPublic = await this.checkAndSyncSteam(userId, steamId);
      const privacyParam = isPublic ? '' : '&steam_private=true';
      res.redirect(`${clientUrl}${returnTo}?steam=success${privacyParam}`);
    } catch (error) {
      this.logger.error('Steam link error:', error);
      res.redirect(
        `${clientUrl}${returnTo}?steam=error&message=${encodeURIComponent(error instanceof Error ? error.message : 'Steam link failed')}`,
      );
    }
  }

  /** Extract returnTo from signed state, defaulting to /profile. */
  private extractReturnToFromState(state: string | undefined): string {
    if (!state) return '/profile';
    const stateData = this.verifyState(state);
    if (!stateData) return '/profile';
    return validateSteamReturnTo(stateData.returnTo);
  }

  /** Process the Steam link callback: verify state, verify OpenID, link account. */
  private async processLinkCallback(
    query: Record<string, string>,
  ): Promise<{ userId: number; steamId: string }> {
    if (!query.state) throw new Error('Missing state parameter');
    const stateData = this.verifyState(query.state);
    if (!stateData || stateData.action !== 'steam_link')
      throw new Error('Invalid or tampered state parameter');
    const userId = stateData.userId as number;
    const steamId = await verifySteamOpenId(query);
    if (!steamId) throw new Error('Steam verification failed');
    await this.usersService.linkSteam(userId, steamId);
    this.logger.log(`Steam account ${steamId} linked to user ${userId}`);
    return { userId, steamId };
  }

  /** Check Steam privacy and auto-sync library if public. Returns isPublic. */
  private async checkAndSyncSteam(
    userId: number,
    steamId: string,
  ): Promise<boolean> {
    const apiKey = await this.settingsService.getSteamApiKey();
    if (!apiKey) return false;
    const profile = await getPlayerSummary(apiKey, steamId);
    const isPublic = profile?.communityvisibilitystate === 3;
    if (isPublic) {
      this.steamService.syncLibrary(userId).catch((err: unknown) => {
        this.logger.warn(
          `Auto-sync library after Steam link failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
      this.steamWishlistService.syncWishlist(userId).catch((err: unknown) => {
        this.logger.warn(
          `Auto-sync wishlist after Steam link failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    }
    return isPublic;
  }

  /**
   * GET /auth/steam/status
   * Get current user's Steam link status.
   */
  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  async steamStatus(
    @Req() req: AuthenticatedExpressRequest,
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
  async syncLibrary(@Req() req: AuthenticatedExpressRequest) {
    Sentry.setUser({ id: req.user.id.toString() });
    try {
      const result = await this.steamService.syncLibrary(req.user.id);
      return {
        success: true,
        message: `Synced ${result.matched} games (${result.newInterests} new, ${result.updatedPlaytime} updated playtime)`,
        ...result,
      };
    } catch (error) {
      this.logger.error('Steam sync error:', error);
      throw error;
    }
  }

  /**
   * POST /auth/steam/sync-wishlist
   * Manually trigger a Steam wishlist sync for the current user.
   */
  @RateLimit('auth')
  @Post('sync-wishlist')
  @UseGuards(AuthGuard('jwt'))
  async syncWishlist(@Req() req: AuthenticatedExpressRequest) {
    Sentry.setUser({ id: req.user.id.toString() });
    const result = await this.steamWishlistService.syncWishlist(req.user.id);
    return {
      success: true,
      message: `Synced wishlist: ${result.matched} matched (${result.newInterests} new, ${result.removed} removed)`,
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
  async unlinkSteam(@Req() req: AuthenticatedExpressRequest) {
    await this.usersService.unlinkSteam(req.user.id);
    this.logger.log(`Steam account unlinked for user ${req.user.id}`);
  }
}
