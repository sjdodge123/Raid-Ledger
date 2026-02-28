/**
 * Additional unit tests for ROK-137 Discord signup methods:
 *  - signupDiscord (anonymous)
 *  - updateStatus
 *  - findByDiscordUser
 *  - cancelByDiscordUser
 *  - claimAnonymousSignups
 */
/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { BenchPromotionService } from './bench-promotion.service';

describe('SignupsService — ROK-137 Discord signup methods', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: { create: jest.Mock };
  let mockBenchPromotionService: {
    schedulePromotion: jest.Mock;
    cancelPromotion: jest.Mock;
    isEligible: jest.Mock;
  };

  const mockEvent = {
    id: 1,
    title: 'Raid Night',
    creatorId: 5,
    maxAttendees: null,
    slotConfig: null,
    gameId: null,
  };

  const mockUser = {
    id: 1,
    username: 'linkeduser',
    avatar: 'avatar.png',
    discordId: 'discord-user-123',
    role: 'member',
    displayName: null,
    customAvatarUrl: null,
  };

  const mockAnonymousSignup = {
    id: 10,
    eventId: 1,
    userId: null,
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
    discordAvatarHash: 'avatar-hash-abc',
    note: null,
    signedUpAt: new Date(),
    characterId: null,
    confirmationStatus: 'confirmed',
    status: 'signed_up',
  };

  const mockLinkedSignup = {
    id: 11,
    eventId: 1,
    userId: 1,
    discordUserId: null,
    discordUsername: null,
    discordAvatarHash: null,
    note: null,
    signedUpAt: new Date(),
    characterId: null,
    confirmationStatus: 'pending',
    status: 'signed_up',
  };

  /** Helper to create a simple select chain returning a specific value */
  function makeSelectChain(resolvedValue: unknown[]) {
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    };
  }

  /** Helper for select chains with leftJoin (getRoster pattern) */
  function makeSelectWithJoins(resolvedValue: unknown[]) {
    return {
      from: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(resolvedValue),
            }),
          }),
        }),
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    };
  }

  beforeEach(async () => {
    mockNotificationService = { create: jest.fn().mockResolvedValue(null) };
    mockBenchPromotionService = {
      schedulePromotion: jest.fn().mockResolvedValue(undefined),
      cancelPromotion: jest.fn().mockResolvedValue(undefined),
      isEligible: jest.fn().mockResolvedValue(false),
    };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      transaction: jest.fn(),
    };

    // Default insert chain
    const insertChain = {
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    // Default delete chain
    const deleteChain = {
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    };
    mockDb.delete.mockReturnValue(deleteChain);

    // Default update chain
    const updateChain = {
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    };
    mockDb.update.mockReturnValue(updateChain);

    // Transaction executes callback with mockDb
    mockDb.transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: BenchPromotionService, useValue: mockBenchPromotionService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
  });

  // ============================================================
  // signupDiscord
  // ============================================================

  describe('signupDiscord', () => {
    it('should create anonymous signup for unlinked Discord user', async () => {
      mockDb.select
        // 1. event exists
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]));

      const result = await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
        discordAvatarHash: 'avatar-hash-abc',
      });

      expect(result.isAnonymous).toBe(true);
      expect(result.discordUserId).toBe('discord-anon-456');
      expect(result.discordUsername).toBe('AnonUser');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should use normal signup path when Discord user has a linked RL account', async () => {
      const signupSpy = jest.spyOn(service, 'signup').mockResolvedValueOnce({
        id: 11,
        eventId: 1,
        user: { id: 1, discordId: 'discord-user-123', username: 'linkeduser', avatar: null },
        note: null,
        signedUpAt: new Date().toISOString(),
        characterId: null,
        character: null,
        confirmationStatus: 'pending',
        status: 'signed_up',
      });

      mockDb.select
        // 1. event exists
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        // 2. linked RL user found
        .mockReturnValueOnce(makeSelectChain([mockUser]));

      await service.signupDiscord(1, {
        discordUserId: 'discord-user-123',
        discordUsername: 'linkeduser',
      });

      expect(signupSpy).toHaveBeenCalledWith(1, mockUser.id, {
        preferredRoles: undefined,
        slotRole: undefined,
      });
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));

      await expect(
        service.signupDiscord(999, {
          discordUserId: 'discord-anon',
          discordUsername: 'AnonUser',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing anonymous signup on duplicate (onConflictDoNothing empty)', async () => {
      mockDb.select
        // 1. event exists
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: existing signup after conflict
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));

      // Insert conflict returns empty array
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      expect(result).toMatchObject({
        id: expect.any(Number),
        isAnonymous: true,
      });
    });

    it('should create roster assignment when role is provided', async () => {
      mockDb.select
        // 1. event exists
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: position lookup (no existing positions → position 1)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      // First insert: signup, second insert: roster assignment
      mockDb.insert
        .mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
        role: 'dps',
      });

      // Roster assignment was inserted
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should set status to tentative when dto.status is tentative', async () => {
      const tentativeSignup = { ...mockAnonymousSignup, status: 'tentative' };

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]));

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([tentativeSignup]),
          }),
        }),
      });

      const result = await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
        status: 'tentative',
      });

      expect(result.status).toBe('tentative');
    });
  });

  // ============================================================
  // ROK-451: Generic auto-slot for Discord signups
  // ============================================================

  describe('signupDiscord — ROK-451 generic auto-slot', () => {
    const genericEvent = {
      ...mockEvent,
      slotConfig: { type: 'generic', player: 4, bench: 2 },
    };

    const mmoEvent = {
      ...mockEvent,
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
    };

    const maxAttendeesEvent = {
      ...mockEvent,
      slotConfig: null,
      maxAttendees: 4,
    };

    it('should auto-assign to player slot for generic event without explicit role', async () => {
      mockDb.select
        // 1. event exists (generic slotConfig)
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: resolveGenericSlotRole — current player assignments (none)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        })
        // 4. inside transaction: position lookup for 'player' role
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      // First insert: signup, second insert: roster assignment
      mockDb.insert
        .mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      // Signup + roster assignment = 2 inserts
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should NOT auto-slot for MMO events (role selection required)', async () => {
      mockDb.select
        // 1. event exists (MMO slotConfig)
        .mockReturnValueOnce(makeSelectChain([mmoEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]));

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
          }),
        }),
      });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      // Only 1 insert: signup (no roster assignment)
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-slot when all generic player slots are full', async () => {
      mockDb.select
        // 1. event exists (generic, 4 player slots)
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: resolveGenericSlotRole — 4 existing player assignments (full)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { position: 1 },
              { position: 2 },
              { position: 3 },
              { position: 4 },
            ]),
          }),
        });

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
          }),
        }),
      });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      // Only 1 insert: signup (no roster assignment — slots full)
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should auto-slot when event has maxAttendees but no slotConfig', async () => {
      mockDb.select
        // 1. event exists (maxAttendees=4, no slotConfig)
        .mockReturnValueOnce(makeSelectChain([maxAttendeesEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: resolveGenericSlotRole — 2 existing player assignments (2 open)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { position: 1 },
              { position: 2 },
            ]),
          }),
        })
        // 4. inside transaction: position lookup for 'player' role
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { position: 1 },
              { position: 2 },
            ]),
          }),
        });

      mockDb.insert
        .mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      // Signup + roster assignment = 2 inserts
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should NOT auto-slot when event has no slotConfig and no maxAttendees', async () => {
      // This is the default mockEvent (slotConfig: null, maxAttendees: null)
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]));

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
          }),
        }),
      });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
      });

      // Only 1 insert: signup (organizer manages slots manually)
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should prefer explicit role over auto-slot for generic events', async () => {
      mockDb.select
        // 1. event exists (generic slotConfig)
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        // 2. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 3. inside transaction: position lookup for explicit 'dps' role
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.insert
        .mockReturnValueOnce({
          values: jest.fn().mockReturnValue({
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

      await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
        role: 'dps',
      });

      // Explicit role takes precedence — 2 inserts (signup + assignment)
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // updateStatus
  // ============================================================

  describe('updateStatus', () => {
    it('should update status to tentative for anonymous Discord user', async () => {
      const updatedSignup = { ...mockAnonymousSignup, status: 'tentative' };

      mockDb.select.mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedSignup]),
          }),
        }),
      });

      const result = await service.updateStatus(
        1,
        { discordUserId: 'discord-anon-456' },
        { status: 'tentative' },
      );

      expect(result.status).toBe('tentative');
      expect(result.isAnonymous).toBe(true);
    });

    it('should update status for linked RL user and return user info', async () => {
      const updatedLinkedSignup = { ...mockLinkedSignup, status: 'declined' };

      mockDb.select
        // 1. find signup by userId
        .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]))
        // 2. fetch user for response
        .mockReturnValueOnce(makeSelectChain([mockUser]));

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedLinkedSignup]),
          }),
        }),
      });

      const result = await service.updateStatus(
        1,
        { userId: 1 },
        { status: 'declined' },
      );

      expect(result.status).toBe('declined');
      expect(result.user.username).toBe('linkeduser');
    });

    it('should throw NotFoundException when signup is not found', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));

      await expect(
        service.updateStatus(1, { userId: 99 }, { status: 'tentative' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when neither userId nor discordUserId provided', async () => {
      await expect(
        service.updateStatus(1, {}, { status: 'tentative' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update status by discordUserId when user identifier is discord', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ ...mockAnonymousSignup, status: 'signed_up' }]),
          }),
        }),
      });

      const result = await service.updateStatus(
        1,
        { discordUserId: 'discord-anon-456' },
        { status: 'signed_up' },
      );

      expect(result.status).toBe('signed_up');
    });
  });

  // ============================================================
  // findByDiscordUser
  // ============================================================

  describe('findByDiscordUser', () => {
    it('should return linked user signup when Discord user has RL account', async () => {
      mockDb.select
        // 1. find linked user
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        // 2. find signup by userId
        .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]));

      const result = await service.findByDiscordUser(1, 'discord-user-123');

      expect(result).not.toBeNull();
      expect(result?.user.username).toBe('linkeduser');
    });

    it('should return null when linked user has no signup for the event', async () => {
      mockDb.select
        // 1. find linked user
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        // 2. find signup — none
        .mockReturnValueOnce(makeSelectChain([]));

      const result = await service.findByDiscordUser(1, 'discord-user-123');

      expect(result).toBeNull();
    });

    it('should return anonymous signup when Discord user has no RL account', async () => {
      mockDb.select
        // 1. no linked user
        .mockReturnValueOnce(makeSelectChain([]))
        // 2. find anonymous signup by discordUserId
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));

      const result = await service.findByDiscordUser(1, 'discord-anon-456');

      expect(result).not.toBeNull();
      expect(result?.isAnonymous).toBe(true);
      expect(result?.discordUserId).toBe('discord-anon-456');
    });

    it('should return null when no signup exists for anonymous user', async () => {
      mockDb.select
        // 1. no linked user
        .mockReturnValueOnce(makeSelectChain([]))
        // 2. no anonymous signup
        .mockReturnValueOnce(makeSelectChain([]));

      const result = await service.findByDiscordUser(1, 'unknown-discord-id');

      expect(result).toBeNull();
    });

    it('should include character data in linked user signup when character exists', async () => {
      const mockCharacter = {
        id: 'char-uuid-1',
        name: 'Frostweaver',
        class: 'Mage',
        spec: 'Arcane',
        role: 'dps',
        roleOverride: null,
        isMain: true,
        itemLevel: 485,
        level: 60,
        avatarUrl: null,
        race: 'Human',
        faction: 'alliance',
      };
      const signupWithChar = { ...mockLinkedSignup, characterId: 'char-uuid-1' };

      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        .mockReturnValueOnce(makeSelectChain([signupWithChar]))
        // character lookup
        .mockReturnValueOnce(makeSelectChain([mockCharacter]));

      const result = await service.findByDiscordUser(1, 'discord-user-123');

      expect(result?.characterId).toBe('char-uuid-1');
      expect(result?.character?.name).toBe('Frostweaver');
    });
  });

  // ============================================================
  // cancelByDiscordUser
  // ============================================================

  describe('cancelByDiscordUser', () => {
    it('should cancel anonymous signup by discordUserId', async () => {
      const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      mockDb.select
        // 1. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 2. find anonymous signup
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]))
        // 3. fetch event duration (ROK-562)
        .mockReturnValueOnce(makeSelectChain([{ duration: [futureStart, new Date(futureStart.getTime() + 2 * 60 * 60 * 1000)] }]));

      await service.cancelByDiscordUser(1, 'discord-anon-456');

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should delegate to cancel() when Discord user has a linked RL account', async () => {
      const cancelSpy = jest.spyOn(service, 'cancel').mockResolvedValueOnce(undefined);

      mockDb.select
        // 1. find linked RL user
        .mockReturnValueOnce(makeSelectChain([mockUser]));

      await service.cancelByDiscordUser(1, 'discord-user-123');

      expect(cancelSpy).toHaveBeenCalledWith(1, mockUser.id);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no anonymous signup found', async () => {
      mockDb.select
        // 1. no linked RL user
        .mockReturnValueOnce(makeSelectChain([]))
        // 2. no anonymous signup
        .mockReturnValueOnce(makeSelectChain([]));

      await expect(
        service.cancelByDiscordUser(1, 'unknown-discord-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // claimAnonymousSignups
  // ============================================================

  describe('claimAnonymousSignups', () => {
    it('should update userId on anonymous signups matching discordUserId', async () => {
      const claimed = [
        { ...mockAnonymousSignup, userId: 1 },
        { ...mockAnonymousSignup, id: 11, userId: 1 },
      ];

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue(claimed),
          }),
        }),
      });

      const count = await service.claimAnonymousSignups('discord-anon-456', 1);

      expect(count).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return 0 when no anonymous signups exist for Discord user', async () => {
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const count = await service.claimAnonymousSignups('unknown-discord-id', 99);

      expect(count).toBe(0);
    });

    it('should only claim signups with null userId (not already-claimed)', async () => {
      // The where clause uses isNull(userId) — this test verifies db.update is called
      // (the actual SQL filtering is handled by drizzle, we verify the call chain)
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ ...mockAnonymousSignup, userId: 5 }]),
          }),
        }),
      });

      const count = await service.claimAnonymousSignups('discord-anon-456', 5);

      expect(count).toBe(1);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });
});
