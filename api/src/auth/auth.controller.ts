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
    const [user, avatarPref] = await Promise.all([
      this.usersService.findById(req.user.id),
      this.preferencesService.getUserPreference(
        req.user.id,
        'avatarPreference',
      ),
    ]);
    if (!user) throw new UnauthorizedException('User no longer exists');

    const resolvedAvatarUrl = await this.resolveAvatarUrl(
      req.user.id,
      user,
      avatarPref,
    );
    return this.buildProfileResponse(user, avatarPref, resolvedAvatarUrl);
  }

  /** Resolve avatar URL from preference type. */
  private async resolveAvatarUrl(
    userId: number,
    user: { customAvatarUrl: string | null },
    avatarPref: { value: unknown } | null | undefined,
  ): Promise<string | null> {
    const pref = avatarPref?.value as
      | { type: string; characterName?: string }
      | null
      | undefined;
    if (pref?.type === 'custom' && user.customAvatarUrl)
      return user.customAvatarUrl;
    if (pref?.type === 'character' && pref.characterName)
      return this.charactersService.getAvatarUrlByName(
        userId,
        pref.characterName,
      );
    return null;
  }

  /** Build the profile response DTO. */
  private buildProfileResponse(
    user: NonNullable<Awaited<ReturnType<typeof this.usersService.findById>>>,
    avatarPref: { value: unknown } | null | undefined,
    resolvedAvatarUrl: string | null,
  ) {
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

    const mismatch = await this.checkDiscordIdMismatch(
      req.user.id,
      payload.discordId,
    );
    if (mismatch) return mismatch;

    return this.executeIntentRedemption(req.user.id, payload.eventId);
  }

  /** Check if the intent token's Discord ID matches the logged-in user. */
  private async checkDiscordIdMismatch(
    userId: number,
    tokenDiscordId?: string,
  ): Promise<RedeemIntentResponseDto | null> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser?.discordId &&
      tokenDiscordId &&
      currentUser.discordId !== tokenDiscordId
    ) {
      this.logger.warn(
        `Intent token Discord ID mismatch: token=${tokenDiscordId}, user=${currentUser.discordId}`,
      );
      return {
        success: false,
        message: 'This signup link was generated for a different Discord user',
      };
    }
    return null;
  }

  /** Execute the signup and claim anonymous signups. */
  private async executeIntentRedemption(
    userId: number,
    eventId: number,
  ): Promise<RedeemIntentResponseDto> {
    try {
      await this.signupsService.signup(eventId, userId);
      await this.claimAnonymousSignupsIfLinked(userId);
      this.logger.log(
        `Redeemed intent token: user ${userId} signed up for event ${eventId}`,
      );
      return { success: true, eventId, message: "You're signed up!" };
    } catch (error) {
      this.logger.error('Failed to redeem intent token:', error);
      return {
        success: false,
        eventId,
        message:
          error instanceof Error ? error.message : 'Failed to process signup',
      };
    }
  }

  /** Claim anonymous signups for the user's Discord account. */
  private async claimAnonymousSignupsIfLinked(userId: number): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (user?.discordId)
      await this.signupsService.claimAnonymousSignups(user.discordId, userId);
  }
}
