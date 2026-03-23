import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

describe('SignupsService — confirm', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;
  let mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  let mockRosterNotificationBuffer: {
    bufferLeave: jest.Mock;
    bufferJoin: jest.Mock;
  };
  let mockBenchPromotionService: {
    schedulePromotion: jest.Mock;
    cancelPromotion: jest.Mock;
    isEligible: jest.Mock;
  };

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: 'avatar.png',
    discordId: '123',
    role: 'member',
  };
  const mockEvent = { id: 1, title: 'Test Event', creatorId: 99 };
  const mockSignup = {
    id: 1,
    eventId: 1,
    userId: 1,
    note: null,
    signedUpAt: new Date(),
    characterId: null,
    confirmationStatus: 'pending',
  };
  const mockCharacter = {
    id: 'char-uuid-1',
    userId: 1,
    gameId: 'game-uuid-1',
    name: 'Frostweaver',
    realm: 'Area52',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps',
    isMain: true,
    itemLevel: 485,
    avatarUrl: null,
    externalId: null,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setupSelectChain() {
    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEvent]),
        }),
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ orderBy: jest.fn().mockResolvedValue([]) }),
          }),
          where: jest
            .fn()
            .mockReturnValue({ orderBy: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    });
  }

  function setupMutationChains() {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    });
    mockDb.delete.mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    });
    mockDb.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockSignup]),
        }),
      }),
    });
    mockDb.transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
    );
  }

  beforeEach(async () => {
    mockNotificationService = {
      create: jest.fn().mockResolvedValue(null),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    };
    mockRosterNotificationBuffer = {
      bufferLeave: jest.fn(),
      bufferJoin: jest.fn(),
    };
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
    setupSelectChain();
    setupMutationChains();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: RosterNotificationBufferService,
          useValue: mockRosterNotificationBuffer,
        },
        { provide: BenchPromotionService, useValue: mockBenchPromotionService },
        {
          provide: SignupsAllocationService,
          useValue: {
            autoAllocateSignup: jest.fn(),
            promoteFromBench: jest.fn(),
            checkTentativeDisplacement: jest.fn(),
            reslotTentativePlayer: jest.fn(),
          },
        },
        {
          provide: SignupsRosterService,
          useValue: {
            cancel: jest.fn(),
            selfUnassign: jest.fn(),
            adminRemoveSignup: jest.fn(),
            updateRoster: jest.fn(),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: ActivityLogService, useValue: { log: jest.fn().mockResolvedValue(undefined), getTimeline: jest.fn().mockResolvedValue({ data: [] }) } },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
  });

  describe('getRoster', () => {
    it('should return roster for event with character data', async () => {
      const signupWithChar = {
        ...mockSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'confirmed',
      };

      // ROK-686: getRoster now queries signups first (single query), skips event check when signups exist
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([
                  {
                    event_signups: signupWithChar,
                    users: mockUser,
                    characters: mockCharacter,
                  },
                ]),
              }),
            }),
          }),
        }),
      });

      const result = await service.getRoster(1);

      expect(result.eventId).toBe(1);
      expect(result.count).toBe(1);
      expect(result.signups[0].user.username).toBe('testuser');
      expect(result.signups[0].character?.name).toBe('Frostweaver');
      expect(result.signups[0].confirmationStatus).toBe('confirmed');
    });

    it('should return roster with null character for pending signups', async () => {
      // ROK-686: getRoster now queries signups first (single query), skips event check when signups exist
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([
                  {
                    event_signups: mockSignup,
                    users: mockUser,
                    characters: null,
                  },
                ]),
              }),
            }),
          }),
        }),
      });

      const result = await service.getRoster(1);

      expect(result.signups[0].character).toBeNull();
      expect(result.signups[0].confirmationStatus).toBe('pending');
    });

    it('should throw NotFoundException when event does not exist', async () => {
      // ROK-686: getRoster now queries signups first; when empty, does event existence check
      mockDb.select
        // 1. Signups query returns empty
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        })
        // 2. Event existence check returns empty
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(service.getRoster(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmSignup', () => {
    it('should confirm signup with character', async () => {
      const confirmedSignup = {
        ...mockSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'confirmed',
      };

      mockDb.select
        // 1. Fetch signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Verify character belongs to user
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockCharacter]),
            }),
          }),
        })
        // 3. Fetch user for response
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        });

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([confirmedSignup]),
          }),
        }),
      });

      const result = await service.confirmSignup(1, 1, 1, {
        characterId: mockCharacter.id,
      });

      expect(result).toMatchObject({
        characterId: expect.any(String),
        confirmationStatus: 'confirmed',
      });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.confirmSignup(1, 999, 1, { characterId: 'char-uuid' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own signup', async () => {
      const otherUserSignup = { ...mockSignup, userId: 2 };

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([otherUserSignup]),
          }),
        }),
      });

      await expect(
        service.confirmSignup(1, 1, 1, { characterId: 'char-uuid' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when character does not belong to user', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(
        service.confirmSignup(1, 1, 1, { characterId: 'invalid-char' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set status to changed when re-confirming', async () => {
      const alreadyConfirmedSignup = {
        ...mockSignup,
        characterId: 'old-char-id',
        confirmationStatus: 'confirmed',
      };
      const changedSignup = {
        ...alreadyConfirmedSignup,
        characterId: mockCharacter.id,
        confirmationStatus: 'changed',
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([alreadyConfirmedSignup]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockCharacter]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockUser]),
            }),
          }),
        });

      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([changedSignup]),
          }),
        }),
      });

      const result = await service.confirmSignup(1, 1, 1, {
        characterId: mockCharacter.id,
      });

      expect(result.confirmationStatus).toBe('changed');
    });
  });
});
