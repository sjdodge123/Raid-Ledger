import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { PreferencesService } from '../users/preferences.service';
import { SignupsService } from '../events/signups.service';
import type { Request } from 'express';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { CharactersService } from '../characters/characters.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import type Redis from 'ioredis';
import { RedeemIntentSchema } from '@raid-ledger/contract';
import type { RedeemIntentResponseDto } from '@raid-ledger/contract';

import type { UserRole } from '@raid-ledger/contract';

interface RequestWithUser extends Request {
  user: {
    id: number;
    username: string;
    role: UserRole;
    impersonatedBy?: number | null;
  };
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private intentTokenService: IntentTokenService,
    private usersService: UsersService,
    private preferencesService: PreferencesService,
    private signupsService: SignupsService,
    private charactersService: CharactersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * POST /auth/exchange-code
   * Exchanges a one-time auth code for a JWT access token.
   * The code is consumed on first use (single-use, 30s TTL).
   */
  @RateLimit('auth')
  @Post('exchange-code')
  async exchangeCode(
    @Body() body: { code: string },
  ): Promise<{ access_token: string }> {
    if (!body.code) {
      throw new BadRequestException('Auth code is required');
    }

    const redisKey = `auth_code:${body.code}`;
    const token = await this.redis.get(redisKey);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired auth code');
    }

    // Consume the code (single-use)
    await this.redis.del(redisKey);

    return { access_token: token };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Req() req: RequestWithUser) {
    // Fetch user data and avatar preference in parallel (ROK-448: was sequential)
    const [user, avatarPref] = await Promise.all([
      this.usersService.findById(req.user.id),
      this.preferencesService.getUserPreference(
        req.user.id,
        'avatarPreference',
      ),
    ]);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // ROK-414: Resolve avatar URL server-side instead of sending all characters
    let resolvedAvatarUrl: string | null = null;
    const pref = avatarPref?.value as
      | { type: string; characterName?: string }
      | null
      | undefined;

    if (pref?.type === 'custom' && user.customAvatarUrl) {
      resolvedAvatarUrl = user.customAvatarUrl;
    } else if (pref?.type === 'character' && pref.characterName) {
      resolvedAvatarUrl = await this.charactersService.getAvatarUrlByName(
        req.user.id,
        pref.characterName,
      );
    }
    // 'discord' type: resolvedAvatarUrl stays null — client uses user.avatar

    return {
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      customAvatarUrl: user.customAvatarUrl,
      role: user.role,
      onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
      avatarPreference: avatarPref?.value ?? null,
      resolvedAvatarUrl,
    };
  }

  /**
   * POST /auth/redeem-intent
   * Validates an intent token and processes the deferred signup (ROK-137).
   * Called after Discord OAuth completes for the "Join & Sign Up" flow.
   * Requires authentication (user just completed OAuth).
   */
  @RateLimit('auth')
  @Post('redeem-intent')
  @UseGuards(AuthGuard('jwt'))
  async redeemIntent(
    @Req() req: RequestWithUser,
    @Body() body: unknown,
  ): Promise<RedeemIntentResponseDto> {
    const dto = RedeemIntentSchema.parse(body);

    const payload = await this.intentTokenService.validate(dto.token);
    if (!payload) {
      return {
        success: false,
        message: 'Intent token is invalid, expired, or already used',
      };
    }

    // Verify the intent token's Discord ID matches the logged-in user's Discord account.
    // Prevents token theft: even if someone intercepts the URL, they can't redeem it
    // under a different Discord identity.
    const currentUser = await this.usersService.findById(req.user.id);
    if (
      currentUser?.discordId &&
      payload.discordId &&
      currentUser.discordId !== payload.discordId
    ) {
      this.logger.warn(
        `Intent token Discord ID mismatch: token=${payload.discordId}, user=${currentUser.discordId}`,
      );
      return {
        success: false,
        message: 'This signup link was generated for a different Discord user',
      };
    }

    try {
      // Auto-complete the signup
      await this.signupsService.signup(payload.eventId, req.user.id);

      // Claim any anonymous signups this Discord user had
      if (req.user.id) {
        const user = await this.usersService.findById(req.user.id);
        if (user?.discordId) {
          await this.signupsService.claimAnonymousSignups(
            user.discordId,
            req.user.id,
          );
        }
      }

      this.logger.log(
        `Redeemed intent token: user ${req.user.id} signed up for event ${payload.eventId}`,
      );

      return {
        success: true,
        eventId: payload.eventId,
        message: "You're signed up!",
      };
    } catch (error) {
      this.logger.error('Failed to redeem intent token:', error);
      return {
        success: false,
        eventId: payload.eventId,
        message:
          error instanceof Error ? error.message : 'Failed to process signup',
      };
    }
  }
}
