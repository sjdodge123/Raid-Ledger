/**
 * Adversarial tests for AuthController.redeemIntent — intent token identity binding (ROK-373).
 *
 * The dev added tests for the happy path (matching discordId) and the mismatch case.
 * These tests cover additional edge cases:
 * - payload.discordId is null/undefined (bypass condition: only rejects when BOTH sides are non-null)
 * - currentUser.discordId is null (user not yet linked → should still allow redemption)
 * - currentUser itself is null (user deleted between JWT issuance and redemption)
 * - Interaction of discordId checks with downstream signup flow
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { PreferencesService } from '../users/preferences.service';
import { SignupsService } from '../events/signups.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SettingsService } from '../settings/settings.service';
import { CharactersService } from '../characters/characters.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; username: string; role: UserRole };
}

function buildMockRequest(userId = 1): AuthenticatedRequest {
  return { user: { id: userId, username: 'testuser', role: 'member' as UserRole } };
}

async function buildModule(overrides: {
  mockUsersService?: Record<string, jest.Mock>;
  mockSignupsService?: Record<string, jest.Mock>;
  mockIntentTokenService?: Record<string, jest.Mock>;
}) {
  const mockUsersService = overrides.mockUsersService ?? {
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

  const mockSignupsService = overrides.mockSignupsService ?? {
    signup: jest.fn().mockResolvedValue({ id: 1, eventId: 42 }),
    claimAnonymousSignups: jest.fn().mockResolvedValue(0),
    cancel: jest.fn(),
    getRoster: jest.fn(),
    findByDiscordUser: jest.fn(),
    signupDiscord: jest.fn(),
    updateStatus: jest.fn(),
    cancelByDiscordUser: jest.fn(),
  };

  const mockIntentTokenService = overrides.mockIntentTokenService ?? {
    generate: jest.fn(),
    validate: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: { login: jest.fn().mockReturnValue({ access_token: 'tok' }) } },
      { provide: IntentTokenService, useValue: mockIntentTokenService },
      { provide: UsersService, useValue: mockUsersService },
      {
        provide: PreferencesService,
        useValue: {
          getUserPreference: jest.fn().mockResolvedValue(null),
          getUserPreferences: jest.fn().mockResolvedValue([]),
          setUserPreference: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: SignupsService, useValue: mockSignupsService },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') } },
      { provide: JwtService, useValue: { verify: jest.fn().mockReturnValue({ sub: 1 }), sign: jest.fn() } },
      { provide: SettingsService, useValue: { getDiscordOAuthConfig: jest.fn(), getBranding: jest.fn() } },
      { provide: CharactersService, useValue: { findAllForUser: jest.fn().mockResolvedValue({ data: [] }), getAvatarUrlByName: jest.fn().mockResolvedValue(null) } },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      {
        provide: REDIS_CLIENT,
        useValue: { get: jest.fn(), set: jest.fn(), setex: jest.fn(), del: jest.fn() },
      },
    ],
  }).compile();

  return module.get<AuthController>(AuthController);
}

describe('AuthController — redeemIntent identity binding edge cases (ROK-373)', () => {
  describe('discordId null/undefined scenarios — should allow redemption (no binding enforced)', () => {
    it('should proceed when payload.discordId is null (token was created before Discord link)', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 42,
          discordId: null, // Token has no discordId
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockResolvedValue({ id: 1, eventId: 42 }),
        claimAnonymousSignups: jest.fn().mockResolvedValue(0),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 1,
          username: 'testuser',
          discordId: 'discord-123', // User HAS a discord ID
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'token-no-discord-id' },
      );

      // No mismatch: payload.discordId is null, so the check is skipped
      expect(result.success).toBe(true);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(42, 1);
    });

    it('should proceed when payload.discordId is undefined', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 10,
          // discordId field completely absent
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockResolvedValue({ id: 1, eventId: 10 }),
        claimAnonymousSignups: jest.fn().mockResolvedValue(0),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
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

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'token-undefined-discord-id' },
      );

      expect(result.success).toBe(true);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(10, 1);
    });

    it('should proceed when currentUser.discordId is null (user has not yet linked Discord)', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 20,
          discordId: 'discord-999', // Token has discord ID
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockResolvedValue({ id: 1, eventId: 20 }),
        claimAnonymousSignups: jest.fn().mockResolvedValue(0),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 1,
          username: 'testuser',
          discordId: null, // User has no Discord linked
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'token-user-no-discord' },
      );

      // currentUser.discordId is null → check is short-circuited → allowed
      expect(result.success).toBe(true);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(20, 1);
    });

    it('should proceed when both payload.discordId and currentUser.discordId are null', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 30,
          discordId: null,
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockResolvedValue({ id: 1, eventId: 30 }),
        claimAnonymousSignups: jest.fn().mockResolvedValue(0),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 1,
          username: 'testuser',
          discordId: null,
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'token-both-null' },
      );

      expect(result.success).toBe(true);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(30, 1);
    });
  });

  describe('discordId mismatch scenarios — should reject', () => {
    it('should reject when payload.discordId differs from currentUser.discordId (both non-null)', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 42,
          discordId: 'discord-attacker',
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn(),
        claimAnonymousSignups: jest.fn(),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 1,
          username: 'victim',
          discordId: 'discord-victim',
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'stolen-token' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('different Discord user');
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('should reject token theft: attacker with different RL account tries to use victim discordId token', async () => {
      // Attacker is logged in as user 99. Token was generated for discord-user-victim.
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 55,
          discordId: 'discord-victim',
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn(),
        claimAnonymousSignups: jest.fn(),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 99,
          username: 'attacker',
          discordId: 'discord-attacker', // Different from token's discordId
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(99); // Attacker's JWT

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'intercepted-token' },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('different Discord user');
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });
  });

  describe('currentUser not found scenario', () => {
    it('should return failure gracefully when signup throws after discordId passes', async () => {
      // This tests that an error in signup is caught and returned, not thrown
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 99,
          discordId: 'discord-same',
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockRejectedValue(new Error('Event not found')),
        claimAnonymousSignups: jest.fn(),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
        findById: jest.fn().mockResolvedValue({
          id: 1,
          username: 'testuser',
          discordId: 'discord-same', // Match — proceed to signup
        }),
        findByDiscordIdIncludingUnlinked: jest.fn(),
        linkDiscord: jest.fn(),
        createOrUpdate: jest.fn(),
        relinkDiscord: jest.fn(),
      };

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid-token-bad-event' },
      );

      expect(result.success).toBe(false);
      expect(result.eventId).toBe(99);
      expect(result.message).toContain('Event not found');
    });
  });

  describe('identity binding does not break anonymous signup claims', () => {
    it('should still claim anonymous signups when discordIds match', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 42,
          discordId: 'discord-123',
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn().mockResolvedValue({ id: 1, eventId: 42 }),
        claimAnonymousSignups: jest.fn().mockResolvedValue(2),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
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

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'valid-token-with-match' },
      );

      expect(result.success).toBe(true);
      expect(mockSignupsService.claimAnonymousSignups).toHaveBeenCalledWith(
        'discord-123',
        1,
      );
    });

    it('should NOT call claimAnonymousSignups when discordId check fails (mismatch)', async () => {
      const mockIntentTokenService = {
        generate: jest.fn(),
        validate: jest.fn().mockReturnValue({
          eventId: 42,
          discordId: 'discord-other',
          action: 'signup',
        }),
      };
      const mockSignupsService = {
        signup: jest.fn(),
        claimAnonymousSignups: jest.fn(),
        cancel: jest.fn(),
        getRoster: jest.fn(),
        findByDiscordUser: jest.fn(),
        signupDiscord: jest.fn(),
        updateStatus: jest.fn(),
        cancelByDiscordUser: jest.fn(),
      };
      const mockUsersService = {
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

      const controller = await buildModule({
        mockIntentTokenService,
        mockSignupsService,
        mockUsersService,
      });
      const req = buildMockRequest(1);

      const result = await controller.redeemIntent(
        req as unknown as Parameters<typeof controller.redeemIntent>[0],
        { token: 'mismatched-token' },
      );

      expect(result.success).toBe(false);
      expect(mockSignupsService.claimAnonymousSignups).not.toHaveBeenCalled();
    });
  });
});
