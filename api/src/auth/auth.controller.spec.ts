/**
 * Unit tests for AuthController — focusing on POST /auth/redeem-intent (ROK-137)
 * and GET /auth/me (ROK-352).
 * Discord routes have been moved to DiscordAuthController (ROK-267).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { PreferencesService } from '../users/preferences.service';
import { SignupsService } from '../events/signups.service';
import { CharactersService } from '../characters/characters.service';
import { REDIS_CLIENT } from '../redis/redis.module';
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
  let mockPreferencesService: {
    getUserPreference: jest.Mock;
    getUserPreferences: jest.Mock;
    setUserPreference: jest.Mock;
  };
  let mockCharactersService: {
    findAllForUser: jest.Mock;
    getAvatarUrlByName: jest.Mock;
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
    mockPreferencesService = {
      getUserPreference: jest.fn().mockResolvedValue(null),
      getUserPreferences: jest.fn().mockResolvedValue([]),
      setUserPreference: jest.fn().mockResolvedValue(undefined),
    };
    mockCharactersService = {
      findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
      getAvatarUrlByName: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: IntentTokenService, useValue: mockIntentTokenService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: PreferencesService, useValue: mockPreferencesService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: CharactersService, useValue: mockCharactersService },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            setex: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
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
      // User without discordId — mocked twice: once for identity binding check,
      // once for the claim-anonymous-signups lookup
      mockUsersService.findById
        .mockResolvedValueOnce({ id: 1, username: 'testuser', discordId: null })
        .mockResolvedValueOnce({
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
        discordId: 'discord-123',
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

    it('should reject when intent token discordId does not match logged-in user', async () => {
      mockIntentTokenService.validate.mockReturnValueOnce({
        eventId: 42,
        discordId: 'discord-other-user',
        action: 'signup',
      });
      mockUsersService.findById.mockResolvedValueOnce({
        id: 1,
        username: 'testuser',
        discordId: 'discord-123',
      });

      const result = await controller.redeemIntent(
        mockRequest as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'stolen.intent.token' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('different Discord user');
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });
  });
});

// ============================================================
// Adversarial tests: GET /auth/me — avatarPreference (ROK-352)
// ============================================================

describe('AuthController — getProfile (ROK-352)', () => {
  let controller: AuthController;
  let mockUsersService: {
    findById: jest.Mock;
    findByDiscordIdIncludingUnlinked: jest.Mock;
    linkDiscord: jest.Mock;
    createOrUpdate: jest.Mock;
    relinkDiscord: jest.Mock;
  };
  let mockPreferencesService: {
    getUserPreference: jest.Mock;
    getUserPreferences: jest.Mock;
    setUserPreference: jest.Mock;
  };
  let mockAuthService: { login: jest.Mock };
  let mockIntentTokenService: { generate: jest.Mock; validate: jest.Mock };
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
  let mockCharactersService: {
    findAllForUser: jest.Mock;
    getAvatarUrlByName: jest.Mock;
  };

  const makeRequest = (userId: number) => ({
    user: { id: userId, username: 'testuser', role: 'member' as UserRole },
  });

  const buildModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: IntentTokenService, useValue: mockIntentTokenService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: PreferencesService, useValue: mockPreferencesService },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: CharactersService, useValue: mockCharactersService },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            setex: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();
    return module.get<AuthController>(AuthController);
  };

  beforeEach(() => {
    mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        id: 1,
        username: 'testuser',
        discordId: 'discord-123',
        displayName: null,
        avatar: 'abc123',
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
      }),
      findByDiscordIdIncludingUnlinked: jest.fn(),
      linkDiscord: jest.fn(),
      createOrUpdate: jest.fn(),
      relinkDiscord: jest.fn(),
    };
    mockPreferencesService = {
      getUserPreference: jest.fn().mockResolvedValue(null),
      getUserPreferences: jest.fn().mockResolvedValue([]),
      setUserPreference: jest.fn().mockResolvedValue(undefined),
    };
    mockAuthService = {
      login: jest.fn().mockReturnValue({ access_token: 'tok' }),
    };
    mockIntentTokenService = { generate: jest.fn(), validate: jest.fn() };
    mockSignupsService = {
      signup: jest.fn(),
      claimAnonymousSignups: jest.fn(),
      cancel: jest.fn(),
      getRoster: jest.fn(),
      findByDiscordUser: jest.fn(),
      signupDiscord: jest.fn(),
      updateStatus: jest.fn(),
      cancelByDiscordUser: jest.fn(),
    };
    mockCharactersService = {
      findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
      getAvatarUrlByName: jest.fn().mockResolvedValue(null),
    };
  });

  it('includes avatarPreference: null in response when no preference stored', async () => {
    mockPreferencesService.getUserPreference.mockResolvedValueOnce(null);
    controller = await buildModule();

    const result = await controller.getProfile(makeRequest(1) as any);

    expect(result).toHaveProperty('avatarPreference', null);
  });

  it('includes avatarPreference value when stored preference exists', async () => {
    const pref = { type: 'discord' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    controller = await buildModule();

    const result = await controller.getProfile(makeRequest(1) as any);

    expect(result).toHaveProperty('avatarPreference', pref);
  });

  it('includes character preference with characterName in response', async () => {
    const pref = { type: 'character', characterName: 'Thrall' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    controller = await buildModule();

    const result = await controller.getProfile(makeRequest(1) as any);

    expect((result as Record<string, unknown>).avatarPreference).toEqual({
      type: 'character',
      characterName: 'Thrall',
    });
  });

  it('includes custom preference in response', async () => {
    const pref = { type: 'custom' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    controller = await buildModule();

    const result = await controller.getProfile(makeRequest(1) as any);

    expect((result as Record<string, unknown>).avatarPreference).toEqual({
      type: 'custom',
    });
  });

  it('calls getUserPreference with correct userId and key "avatarPreference"', async () => {
    controller = await buildModule();

    await controller.getProfile(makeRequest(42) as any);

    expect(mockPreferencesService.getUserPreference).toHaveBeenCalledWith(
      42,
      'avatarPreference',
    );
  });

  it('throws UnauthorizedException when user not found in DB', async () => {
    mockUsersService.findById.mockResolvedValueOnce(null);
    controller = await buildModule();

    const req = makeRequest(1);

    await expect(controller.getProfile(req as any)).rejects.toThrow(
      'User no longer exists',
    );
  });

  it('response includes all required user fields', async () => {
    const pref = { type: 'discord' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    controller = await buildModule();

    const result = await controller.getProfile(makeRequest(1) as any);

    expect(result).toMatchObject({
      id: 1,
      discordId: 'discord-123',
      username: 'testuser',
      avatar: 'abc123',
      customAvatarUrl: null,
      role: 'member',
      avatarPreference: pref,
      resolvedAvatarUrl: null,
    });
  });

  it('does not include characters array in response (ROK-414)', async () => {
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('characters');
  });

  it('resolvedAvatarUrl is character avatarUrl when preference is character', async () => {
    const pref = { type: 'character', characterName: 'Thrall' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    mockCharactersService.getAvatarUrlByName.mockResolvedValueOnce(
      'https://example.com/thrall.png',
    );
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    expect(result['resolvedAvatarUrl']).toBe('https://example.com/thrall.png');
    expect(mockCharactersService.getAvatarUrlByName).toHaveBeenCalledWith(
      1,
      'Thrall',
    );
  });

  it('resolvedAvatarUrl is customAvatarUrl when preference is custom', async () => {
    const pref = { type: 'custom' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    mockUsersService.findById.mockResolvedValueOnce({
      id: 1,
      username: 'testuser',
      discordId: 'discord-123',
      displayName: null,
      avatar: 'abc123',
      customAvatarUrl: '/avatars/user-1.webp',
      role: 'member',
      onboardingCompletedAt: null,
    });
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    expect(result['resolvedAvatarUrl']).toBe('/avatars/user-1.webp');
  });

  it('resolvedAvatarUrl is null when preference is discord', async () => {
    const pref = { type: 'discord' };
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: pref,
    });
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    expect(result['resolvedAvatarUrl']).toBeNull();
  });

  it('resolvedAvatarUrl is null when no preference stored', async () => {
    mockPreferencesService.getUserPreference.mockResolvedValueOnce(null);
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    expect(result['resolvedAvatarUrl']).toBeNull();
  });

  it('does not expose raw DB row columns not in the return shape', async () => {
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    // These internal DB fields must not leak through
    expect(result['password']).toBeUndefined();
    expect(result['passwordHash']).toBeUndefined();
    expect(result['createdAt']).toBeUndefined();
    expect(result['updatedAt']).toBeUndefined();
  });

  it('avatarPreference is null (not undefined) when preference record has null value', async () => {
    mockPreferencesService.getUserPreference.mockResolvedValueOnce({
      value: null,
    });
    controller = await buildModule();

    const result = (await controller.getProfile(
      makeRequest(1) as any,
    )) as Record<string, unknown>;

    // avatarPref?.value ?? null  → null when value is null
    expect(result['avatarPreference']).toBeNull();
  });
});
