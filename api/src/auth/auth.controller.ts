import {
  Controller,
  Get,
  Req,
  UseGuards,
  Res,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

interface RequestWithUser extends Request {
  user: any;
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private configService: ConfigService,
    private jwtService: JwtService,
    private settingsService: SettingsService,
  ) {}

  /**
   * Sign OAuth state parameter to prevent tampering
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
   * Verify and decode signed OAuth state parameter
   */
  private verifyState(
    state: string,
  ): { userId: number; action: string } | null {
    try {
      const { data, signature } = JSON.parse(
        Buffer.from(state, 'base64').toString(),
      );
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
        return null; // Signature mismatch - state was tampered with
      }

      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Derive client URL from the stored callback URL.
   * e.g., https://raid.gamernight.net/api/auth/discord/callback -> https://raid.gamernight.net
   */
  private async getClientUrl(): Promise<string> {
    const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
    if (oauthConfig?.callbackUrl) {
      try {
        const url = new URL(oauthConfig.callbackUrl);
        return `${url.protocol}//${url.host}`;
      } catch {
        // Fall through to default
      }
    }
    // Fallback to env var or localhost
    return this.configService.get<string>('CLIENT_URL') || 'http://localhost';
  }

  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  async discordLogin() {
    // Initiates the Discord OAuth flow
  }

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  async discordLoginCallback(
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    // User is validated and attached to req.user by DiscordStrategy
    const { access_token } = await this.authService.login(req.user);

    // Redirect to frontend with token (derive URL from callback URL in settings)
    const clientUrl = await this.getClientUrl();
    // Using query param for simplicity in MVP. Secure httpOnly cookie is better for prod.
    res.redirect(`${clientUrl}/auth/success?token=${access_token}`);
  }

  /**
   * GET /auth/discord/link
   * Initiates Discord OAuth with signed state containing user ID for linking.
   * Note: Uses token query param since browser redirects can't send Authorization headers.
   */
  @Get('discord/link')
  async discordLink(@Query('token') token: string, @Res() res: Response) {
    // Verify JWT from query param (browser redirects can't send headers)
    if (!token) {
      throw new HttpException(
        'Authentication token required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let userId: number;
    try {
      const payload = this.jwtService.verify(token);
      userId = payload.sub;
    } catch {
      throw new HttpException(
        'Invalid or expired token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Get OAuth config from database settings (ROK-146)
    const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
    if (!oauthConfig) {
      throw new HttpException(
        'Discord OAuth is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Create SIGNED state with user ID and action for linking
    const state = this.signState({
      userId,
      action: 'link',
      timestamp: Date.now(), // Prevent replay attacks
    });

    // Use /link/callback endpoint - separate from login /callback to avoid Passport guard
    const redirectUri = oauthConfig.callbackUrl.replace(
      '/callback',
      '/link/callback',
    );

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${oauthConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`;

    res.redirect(discordAuthUrl);
  }

  /**
   * GET /auth/discord/link/callback
   * Handles Discord OAuth callback for linking (not login)
   */
  @Get('discord/link/callback')
  async discordLinkCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const clientUrl = await this.getClientUrl();

    try {
      // Get OAuth config from database settings (ROK-146)
      const oauthConfig = await this.settingsService.getDiscordOAuthConfig();
      if (!oauthConfig) {
        throw new Error('Discord OAuth is not configured');
      }

      // Verify signed state to get user ID
      const stateData = this.verifyState(state);
      if (!stateData) {
        throw new Error('Invalid or tampered state parameter');
      }

      const { userId, action } = stateData;

      if (action !== 'link') {
        throw new Error('Invalid state action');
      }

      // Use /link/callback - must match what was sent to Discord
      const redirectUri = oauthConfig.callbackUrl.replace(
        '/callback',
        '/link/callback',
      );

      // Exchange code for access token
      const tokenResponse = await fetch(
        'https://discord.com/api/oauth2/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: oauthConfig.clientId,
            client_secret: oauthConfig.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          }),
        },
      );

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange code for token');
      }

      const tokens = await tokenResponse.json();

      // Get Discord user profile
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Discord profile');
      }

      const discordProfile = await userResponse.json();

      // Link Discord account to user
      await this.usersService.linkDiscord(
        userId,
        discordProfile.id,
        discordProfile.username,
        discordProfile.avatar,
      );

      // Redirect to profile with success
      res.redirect(`${clientUrl}/profile?linked=success`);
    } catch (error) {
      console.error('Discord link error:', error);
      res.redirect(
        `${clientUrl}/profile?linked=error&message=${encodeURIComponent(error instanceof Error ? error.message : 'Link failed')}`,
      );
    }
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Req() req: RequestWithUser) {
    // Fetch fresh user data from database instead of returning cached JWT payload
    // This ensures the UI reflects updated info (e.g., after Discord linking)
    const user = await this.usersService.findById(req.user.id);
    if (!user) {
      return req.user; // Fallback to JWT payload if user not found
    }
    return {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
    };
  }
}
