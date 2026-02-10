import {
  Controller,
  Get,
  Req,
  UseGuards,
  Res,
  Query,
  HttpException,
  HttpStatus,
  Injectable,
  ExecutionContext,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import type { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import * as crypto from 'crypto';

@Injectable()
class DiscordAuthGuard extends AuthGuard('discord') {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host = req.headers.host || 'localhost';
    return { callbackURL: `${proto}://${host}/api/auth/discord/callback` };
  }
}

interface RequestWithUser extends Request {
  user: {
    id: number;
    username: string;
    isAdmin: boolean;
    impersonatedBy?: number | null;
  };
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
        return null; // Signature mismatch - state was tampered with
      }

      return JSON.parse(data) as { userId: number; action: string };
    } catch {
      return null;
    }
  }

  /**
   * Derive the external origin from request headers (proto + host).
   */
  private getOriginUrl(req: Request): string {
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
  }

  /**
   * Get the frontend client URL for post-auth redirects.
   * Uses CLIENT_URL env var if set, otherwise auto-detects from the request.
   */
  private getClientUrl(req: Request): string {
    return (
      this.configService.get<string>('CLIENT_URL') || this.getOriginUrl(req)
    );
  }

  @Get('discord')
  @UseGuards(DiscordAuthGuard)
  async discordLogin() {
    // Initiates the Discord OAuth flow
  }

  @Get('discord/callback')
  @UseGuards(DiscordAuthGuard)
  discordLoginCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    // User is validated and attached to req.user by DiscordStrategy
    const { access_token } = this.authService.login(req.user);

    // Redirect to frontend with token (auto-detect URL from request)
    const clientUrl = this.getClientUrl(req);
    // Using query param for simplicity in MVP. Secure httpOnly cookie is better for prod.
    res.redirect(`${clientUrl}/auth/success?token=${access_token}`);
  }

  /**
   * GET /auth/discord/link
   * Initiates Discord OAuth with signed state containing user ID for linking.
   * Note: Uses token query param since browser redirects can't send Authorization headers.
   */
  @Get('discord/link')
  async discordLink(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Verify JWT from query param (browser redirects can't send headers)
    if (!token) {
      throw new HttpException(
        'Authentication token required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let userId: number;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      userId = this.jwtService.verify(token).sub;
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

    // Derive redirect URI from the incoming request (auto-detect origin)
    const redirectUri = `${this.getOriginUrl(req)}/api/auth/discord/link/callback`;

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
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const clientUrl = this.getClientUrl(req);

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

      // Derive redirect URI from request - must match what was sent to Discord
      const redirectUri = `${this.getOriginUrl(req)}/api/auth/discord/link/callback`;

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

      const tokens = (await tokenResponse.json()) as { access_token: string };

      // Get Discord user profile
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Discord profile');
      }

      const discordProfile = (await userResponse.json()) as {
        id: string;
        username: string;
        avatar?: string;
      };

      // Check if this Discord account is already linked (including unlinked) to a different user
      const existingUser =
        await this.usersService.findByDiscordIdIncludingUnlinked(
          discordProfile.id,
        );

      if (existingUser && existingUser.id !== userId) {
        throw new Error(
          'This Discord account is already linked to another user',
        );
      }

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
