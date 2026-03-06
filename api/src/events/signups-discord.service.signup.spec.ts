/**
 * Unit tests for ROK-137 Discord signup methods — signupDiscord & ROK-451 auto-slot.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';

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

function makeSelectChain(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function createMockDb() {
  const mockDb: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  };
  const insertChain = {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
      returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
    }),
  };
  mockDb.insert.mockReturnValue(insertChain);
  const deleteChain = {
    where: jest
      .fn()
      .mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }),
  };
  mockDb.delete.mockReturnValue(deleteChain);
  const updateChain = {
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
    }),
  };
  mockDb.update.mockReturnValue(updateChain);
  mockDb.transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );
  return mockDb;
}

describe('SignupsService — signupDiscord', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: NotificationService,
          useValue: { create: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: RosterNotificationBufferService,
          useValue: { bufferLeave: jest.fn(), bufferJoin: jest.fn() },
        },
        {
          provide: BenchPromotionService,
          useValue: {
            schedulePromotion: jest.fn(),
            cancelPromotion: jest.fn(),
            isEligible: jest.fn().mockResolvedValue(false),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get<SignupsService>(SignupsService);
  });

  describe('signupDiscord', () => {
    it('should create anonymous signup for unlinked Discord user', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]));
      const result = await service.signupDiscord(1, {
        discordUserId: 'discord-anon-456',
        discordUsername: 'AnonUser',
        discordAvatarHash: 'avatar-hash-abc',
      });
      expect(result.isAnonymous).toBe(true);
      expect(result.discordUserId).toBe('discord-anon-456');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should use normal signup path when Discord user has a linked RL account', async () => {
      const signupSpy = jest.spyOn(service, 'signup').mockResolvedValueOnce({
        id: 11,
        eventId: 1,
        user: {
          id: 1,
          discordId: 'discord-user-123',
          username: 'linkeduser',
          avatar: null,
        },
        note: null,
        signedUpAt: new Date().toISOString(),
        characterId: null,
        character: null,
        confirmationStatus: 'pending',
        status: 'signed_up',
      });
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
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
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest
            .fn()
            .mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }),
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
        .mockReturnValueOnce(makeSelectChain([mockEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
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
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        })
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
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
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should NOT auto-slot for MMO events (role selection required)', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mmoEvent]))
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
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-slot when all generic player slots are full', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
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
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should auto-slot when event has maxAttendees but no slotConfig', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([maxAttendeesEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ position: 1 }, { position: 2 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ position: 1 }, { position: 2 }]),
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
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should NOT auto-slot when event has no slotConfig and no maxAttendees', async () => {
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
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('should prefer explicit role over auto-slot for generic events', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([genericEvent]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
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
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });
  });
});
