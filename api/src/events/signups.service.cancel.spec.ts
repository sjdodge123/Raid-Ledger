import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

describe('SignupsService — cancel', () => {
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

  function mockSelectChainResolving(rows: unknown[]) {
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    };
  }

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
  function setupSelectChain() {
    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEvent]),
        }),
        leftJoin: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([]),
            }),
          }),
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
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
            autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
            promoteFromBench: jest.fn().mockResolvedValue(null),
            checkTentativeDisplacement: jest.fn().mockResolvedValue(undefined),
            reslotTentativePlayer: jest.fn().mockResolvedValue(undefined),
          },
        },
        SignupsRosterService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: ActivityLogService, useValue: { log: jest.fn().mockResolvedValue(undefined), getTimeline: jest.fn().mockResolvedValue({ data: [] }) } },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
  });

  describe('cancel', () => {
    // ROK-562: cancel() now fetches event duration to determine cancel status
    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h from now → 'declined'
    const mockEventDuration = {
      duration: [
        futureStart,
        new Date(futureStart.getTime() + 2 * 60 * 60 * 1000),
      ],
    };

    const mockSelectEventDuration = () => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([mockEventDuration]),
        }),
      }),
    });

    it('should cancel unassigned signup without notification', async () => {
      // 1. Find signup
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
        // 3. Check roster assignment — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await service.cancel(1, 1);

      // ROK-562: cancel now soft-deletes with time-based status
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.cancel(999, 1)).rejects.toThrow(NotFoundException);
    });

    it('should dispatch slot_vacated notification when assigned signup is canceled', async () => {
      const mockAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 2,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        // 1. Find signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
        // 3. Check roster assignment — found
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        // 4. Fetch event (for creatorId + title)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        // 5. Fetch user (for display name)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'Frostmage' }]),
            }),
          }),
        });

      await service.cancel(1, 1);

      // ROK-421: cancel now deletes roster assignment + soft-deletes signup
      expect(mockDb.delete).toHaveBeenCalled(); // roster assignment delete
      expect(mockDb.update).toHaveBeenCalled(); // soft-delete signup
      // ROK-534: organizer notification is now debounced via buffer
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
        organizerId: 5,
        eventId: 1,
        eventTitle: 'Raid Night',
        userId: 1,
        displayName: 'Frostmage',
        vacatedRole: 'healer',
      });
    });

    it('should include eventId in notification payload', async () => {
      const mockAssignment = {
        id: 10,
        signupId: 1,
        role: 'tank',
        position: 1,
        eventId: 42,
        isOverride: 0,
      };
      const signup42 = { ...mockSignup, eventId: 42 };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([signup42]),
            }),
          }),
        })
        // Fetch event duration (ROK-562)
        .mockReturnValueOnce(mockSelectEventDuration())
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 3, title: 'Weekly Clear' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'ShadowBlade' }]),
            }),
          }),
        });

      await service.cancel(42, 1);

      // ROK-534: organizer notification is now debounced via buffer
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 42 }),
      );
    });
  });

  describe('selfUnassign', () => {
    const mockAssignment = {
      id: 10,
      signupId: 1,
      role: 'healer',
      position: 2,
      eventId: 1,
      isOverride: 0,
    };

    it('should throw NotFoundException when signup does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.selfUnassign(1, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when no roster assignment exists', async () => {
      mockDb.select
        // 1. Find signup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockSignup]),
            }),
          }),
        })
        // 2. Find roster assignment — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(service.selfUnassign(1, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    function setupSelfUnassignMocks() {
      const mockRoster = {
        eventId: 1,
        pool: [
          {
            id: 0,
            signupId: 1,
            userId: 1,
            discordId: '123',
            username: 'testuser',
            avatar: 'avatar.png',
            slot: null,
            position: 0,
            isOverride: false,
            character: null,
          },
        ],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      mockDb.select
        .mockReturnValueOnce(mockSelectChainResolving([mockSignup]))
        .mockReturnValueOnce(mockSelectChainResolving([mockAssignment]))
        .mockReturnValueOnce(
          mockSelectChainResolving([{ creatorId: 5, title: 'Raid Night' }]),
        )
        .mockReturnValueOnce(
          mockSelectChainResolving([{ username: 'Frostmage' }]),
        );
    }

    it('should delete assignment, notify organizer, and return updated roster', async () => {
      setupSelfUnassignMocks();

      const result = await service.selfUnassign(1, 1);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
        organizerId: 5,
        eventId: 1,
        eventTitle: 'Raid Night',
        userId: 1,
        displayName: 'Frostmage',
        vacatedRole: 'healer',
      });
      expect(result.pool).toHaveLength(1);
      expect(result.assignments).toHaveLength(0);
    });

    it('should not delete the signup itself', async () => {
      jest.spyOn(service, 'getRosterWithAssignments').mockResolvedValueOnce({
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      });

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
              limit: jest.fn().mockResolvedValue([mockAssignment]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ creatorId: 5, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ username: 'TestUser' }]),
            }),
          }),
        });

      await service.selfUnassign(1, 1);

      // delete was called exactly once (for assignment, not signup)
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });
  });
});
