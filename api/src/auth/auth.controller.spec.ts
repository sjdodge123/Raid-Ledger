/**
 * Unit tests for AuthController — focusing on POST /auth/redeem-intent (ROK-137).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { SignupsService } from '../events/signups.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; username: string; role: UserRole };
}

describe('AuthController — redeemIntent', () => {
  let controller: AuthController;
  let mockIntentTokenService: {
    generate: jest.Mock;
    validate: jest.Mock;
  };
  let mockSignupsService: {
    signup: jest.Mock;
    claimAnonymousSignups: jest.Mock;
    cancel: jest.Mock;
    getRoster: jest.Mock;
    findByDiscordUser: jest.Mock;
    signupDiscord: jest.Mock;
    updateStatus: jest.Mock;
    cancelByDiscordUser: jest.Mock;
  };
  let mockUsersService: {
    findById: jest.Mock;
    findByDiscordIdIncludingUnlinked: jest.Mock;
    linkDiscord: jest.Mock;
    createOrUpdate: jest.Mock;
    relinkDiscord: jest.Mock;
  };
  let mockAuthService: { login: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockJwtService: { verify: jest.Mock; sign: jest.Mock };
  let mockSettingsService: {
    getDiscordOAuthConfig: jest.Mock;
    getBranding: jest.Mock;
  };

  const mockUser = {
    id: 1,
    username: 'testuser',
    role: 'member' as UserRole,
  };

  const mockRequest: AuthenticatedRequest = {
    user: mockUser,
  };

  beforeEach(async () => {
    mockIntentTokenService = {
      generate: jest.fn(),
      validate: jest.fn(),
    };
    mockSignupsService = {
      signup: jest.fn().mockResolvedValue({ id: 1, eventId: 42 }),
      claimAnonymousSignups: jest.fn().mockResolvedValue(0),
      cancel: jest.fn(),
      getRoster: jest.fn(),
      findByDiscordUser: jest.fn(),
      signupDiscord: jest.fn(),
      updateStatus: jest.fn(),
      cancelByDiscordUser: jest.fn(),
    };
    mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        id: 1,
        username: 'testuser',
        discordId: 'discord-123',
      }),
      findByDiscordIdIncludingUnlinked: jest.fn(),
      linkDiscord: jest.fn(),
      createOrUpdate: jest.fn(),
      relinkDiscord: jest.fn(),
    };
    mockAuthService = {
      login: jest.fn().mockReturnValue({ access_token: 'mock.jwt.token' }),
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };
    mockJwtService = {
      verify: jest.fn().mockReturnValue({ sub: 1 }),
      sign: jest.fn().mockReturnValue('mock.jwt.token'),
    };
    mockSettingsService = {
      getDiscordOAuthConfig: jest.fn(),
      getBranding: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: IntentTokenService, useValue: mockIntentTokenService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('redeemIntent', () => {
    it('should return success with eventId when token is valid', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-123',
        action: 'signup',
      });

      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid.intent.token' },
      );

      expect(result.success).toBe(true);
      expect(result.eventId).toBe(42);
      expect(result.message).toBe("You're signed up!");
    });

    it('should call signupsService.signup with correct eventId and userId', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-123',
        action: 'signup',
      });

      await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid.intent.token' },
      );

      expect(mockSignupsService.signup).toHaveBeenCalledWith(42, mockUser.id);
    });

    it('should claim anonymous signups after successful signup', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-123',
        action: 'signup',
      });
      mockUsersService.findById.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        discordId: 'discord-123',
      });

      await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid.intent.token' },
      );

      expect(mockSignupsService.claimAnonymousSignups).toHaveBeenCalledWith(
        'discord-123',
        mockUser.id,
      );
    });

    it('should return failure with message when token is invalid', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce(null);

      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'invalid.token' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid');
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should return failure with message when token is expired (validate returns null)', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce(null);

      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'expired.token' },
      );

      expect(result.success).toBe(false);
    });

    it('should return failure with error message when signup throws', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-123',
        action: 'signup',
      });
      mockSignupsService.signup.mockRejectedValueOnce(
        new Error('Event not found'),
      );

      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid.but.event.gone' },
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBe(42);
      expect(result.message).toContain('Event not found');
    });

    it('should skip claimAnonymousSignups when user has no discordId', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-123',
        action: 'signup',
      });
      // User without discordId
      mockUsersService.findById.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        discordId: null,
      });

      await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid.intent.token' },
      );

      expect(mockSignupsService.claimAnonymousSignups).not.toHaveBeenCalled();
    });

    it('should parse token from request body using RedeemIntentSchema', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 1,
        discordId: 'discord-abc',
        action: 'signup',
      });

      // Pass raw body — it should be parsed by RedeemIntentSchema
      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'raw.body.token' },
      );

      expect(result.success).toBe(true);
      expect(mockIntentTokenService.validate).toHaveBeenCalledWith(
        'raw.body.token',
      );
    });

    it('should throw ZodError when body does not contain token field', async () => {
      await expect(
        controller.redeemIntent(
          mockRequest as unknown as Parameters<
            typeof controller.redeemIntent
          >[0],
          {} as { token: string }, // invalid body — missing token
        ),
      ).rejects.toThrow();
    });
  });
});
