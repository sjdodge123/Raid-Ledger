import { Controller, Get, UseGuards, Req, Res, Query, HttpStatus, Logger, Optional, Inject } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../../settings/settings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { DiscordNotificationService } from '../../notifications/discord-notification.service';
import { discordFetch } from './discord-http.util';
import { REDIS_CLIENT } from '../../redis/redis.module';
import * as crypto from 'crypto';
import type Redis from 'ioredis';
import type { Response, Request } from 'express';
import { AUTH_EVENTS, type DiscordLoginPayload } from '../../auth/auth.service';
import type { UserRole } from '@raid-ledger/contract';
import {
  DiscordAuthGuard, signOAuthState, verifyOAuthState, getOriginUrl,
  exchangeCodeForToken, fetchDiscordProfile,
} from './discord-auth.helpers';

interface RequestWithUser extends Request {
  user: { id: number; username: string; role: UserRole; impersonatedBy?: number | null };
}

@Controller('auth')
export class DiscordAuthController {
  private readonly logger = new Logger(DiscordAuthController.name);

  constructor(
    private authService: AuthService, private usersService: UsersService,
    private configService: ConfigService, private jwtService: JwtService,
    private settingsService: SettingsService,
    @Optional() @Inject(DiscordNotificationService) private discordNotificationService: DiscordNotificationService | null,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Get the frontend client URL for post-auth redirects. */
  private getClientUrl(req: Request): string {
    return this.configService.get<string>('CLIENT_URL') || getOriginUrl(req);
  }

  /** Get JWT secret for state signing. */
  private getSecret(): string {
    return this.configService.get<string>('JWT_SECRET')!;
  }

  @RateLimit('auth')
  @Get('discord')
  @UseGuards(DiscordAuthGuard)
  async discordLogin() {
    // Initiates the Discord OAuth flow
  }

  @RateLimit('auth')
  @Get('discord/callback')
  @UseGuards(DiscordAuthGuard)
  async discordLoginCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    if (res.headersSent) return;
    const { access_token } = this.authService.login(req.user);
    const authCode = crypto.randomBytes(32).toString('hex');
    await this.redis.setex(`auth_code:${authCode}`, 30, access_token);
    const clientUrl = this.getClientUrl(req);

    const stateParam = (req.query as Record<string, string>).state;
    if (stateParam) {
      const stateData = verifyOAuthState(stateParam, this.getSecret(), this.logger);
      if (stateData?.action === 'invite' && stateData.inviteCode) {
        res.redirect(`${clientUrl}/auth/success?code=${authCode}&invite=${encodeURIComponent(stateData.inviteCode as string)}`);
        return;
      }
    }
    res.redirect(`${clientUrl}/auth/success?code=${authCode}`);
  }

  /** GET /auth/discord/invite — initiate Discord OAuth with invite code in signed state (ROK-394). */
  @RateLimit('auth')
  @Get('discord/invite')
  async discordInviteLogin(@Query('code') inviteCode: string, @Req() req: Request, @Res() res: Response) {
    const clientUrl = this.getClientUrl(req);
    if (!inviteCode) { res.redirect(`${clientUrl}/calendar`); return; }

    const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
    if (!oauthConfig) { res.redirect(`${clientUrl}/i/${encodeURIComponent(inviteCode)}?error=discord_not_configured`); return; }

    const state = signOAuthState({ action: 'invite', inviteCode, timestamp: Date.now() }, this.getSecret());
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(oauthConfig.callbackUrl)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`);
  }

  /** GET /auth/discord/link — initiate Discord OAuth for account linking. */
  @RateLimit('auth')
  @Get('discord/link')
  async discordLink(@Query('token') token: string, @Req() req: Request, @Res() res: Response) {
    const clientUrl = this.getClientUrl(req);
    if (!token) { res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Authentication token required' }); return; }

    let userId: number;
    try { userId = this.jwtService.verify<{ sub: number }>(token).sub; } catch {
      res.redirect(`${clientUrl}/profile?linked=error&message=${encodeURIComponent('Invalid or expired token. Please try again.')}`);
      return;
    }

    const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
    if (!oauthConfig) {
      res.redirect(`${clientUrl}/profile?linked=error&message=${encodeURIComponent('Discord OAuth is not configured. Please set it up in admin settings.')}`);
      return;
    }

    const state = signOAuthState({ userId, action: 'link', timestamp: Date.now() }, this.getSecret());
    const redirectUri = oauthConfig.callbackUrl.replace('/callback', '/link/callback');
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`);
  }

  /** GET /auth/discord/link/callback — handle Discord OAuth callback for linking. */
  @RateLimit('auth')
  @Get('discord/link/callback')
  async discordLinkCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const clientUrl = this.getClientUrl(req);
    try {
      const { userId, discordProfile } = await this.performLinkExchange(code, state);
      await this.usersService.linkDiscord(userId, discordProfile.id, discordProfile.username, discordProfile.avatar);
      this.eventEmitter.emit(AUTH_EVENTS.DISCORD_LOGIN, { userId, discordId: discordProfile.id } satisfies DiscordLoginPayload);
      this.sendWelcomeDMSafe(userId);
      res.redirect(`${clientUrl}/profile?linked=success`);
    } catch (error) {
      this.logger.error('Discord link error:', error);
      res.redirect(`${clientUrl}/profile?linked=error&message=${encodeURIComponent(error instanceof Error ? error.message : 'Link failed')}`);
    }
  }

  /** Perform the link OAuth exchange: verify state, exchange code, fetch profile. */
  private async performLinkExchange(code: string, state: string): Promise<{ userId: number; discordProfile: { id: string; username: string; avatar?: string } }> {
    const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
    if (!oauthConfig) throw new Error('Discord OAuth is not configured');

    const stateData = verifyOAuthState(state, this.getSecret(), this.logger);
    if (!stateData || stateData.action !== 'link') throw new Error('Invalid or tampered state parameter');

    const userId = stateData.userId as number;
    const redirectUri = oauthConfig.callbackUrl.replace('/callback', '/link/callback');
    const tokens = await exchangeCodeForToken(code, redirectUri, oauthConfig.clientId, oauthConfig.clientSecret, discordFetch);
    const discordProfile = await fetchDiscordProfile(tokens.access_token, discordFetch);

    const existingUser = await this.usersService.findByDiscordIdIncludingUnlinked(discordProfile.id);
    if (existingUser && existingUser.id !== userId) throw new Error('This Discord account is already linked to another user');

    return { userId, discordProfile };
  }

  /** Send welcome DM safely (fire-and-forget). */
  private sendWelcomeDMSafe(userId: number): void {
    if (!this.discordNotificationService) return;
    this.discordNotificationService.sendWelcomeDM(userId).catch((err: unknown) => {
      this.logger.warn(`Failed to send welcome DM after link: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  }
}
