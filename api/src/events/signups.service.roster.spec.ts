import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';

describe('SignupsService — roster', () => {
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
        SignupsRosterService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SignupsService>(SignupsService);
  });

  describe('updateRoster — ROK-390 role change notifications', () => {
    it('should include "operator" in the permission error message', async () => {
      // Event exists, but user is not creator and not admin
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ ...mockEvent, creatorId: 999 }]),
          }),
        }),
      });

      await expect(
        service.updateRoster(1, 1, false, { assignments: [] }),
      ).rejects.toThrow(
        'Only event creator, admin, or operator can update roster',
      );
    });

    it('should notify player when role changes (healer → dps)', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      // Old assignment: user 1 was healer
      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        // 1. Event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        // 2. Get signups
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        // 3. Get old assignments (for diff)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      // Delete old assignments
      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });

      // Insert new assignments
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'dps',
            position: 3,
            isOverride: false,
          },
        ],
      });

      // Wait for async notification
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          type: 'roster_reassigned',
          title: 'Role Changed',

          payload: expect.objectContaining({
            oldRole: 'healer',
            newRole: 'dps',
          }),
        }),
      );
    });

    it('should use bench_promoted type when moving from bench to a role', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'bench',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'tank',
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bench_promoted',
          title: 'Promoted from Bench',
        }),
      );
    });

    it('should NOT notify when same-role position changes (DPS 1 → DPS 5)', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'dps',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'dps',
            position: 5,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should send roster_reassigned when moved to bench', async () => {
      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10, bench: 5 },
      };
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(mockRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 2,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid Night' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'bench',
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          title: 'Moved to Bench',
        }),
      );
    });
  });

  describe('notifyNewAssignments — ROK-487 generic roster language', () => {
    const emptyRoster = {
      eventId: 1,
      pool: [],
      assignments: [],
      slots: { player: 10, bench: 5 },
    };

    /**
     * Helper: set up mocks for updateRoster with NO prior assignment for the user
     * so that notifyNewAssignments fires (oldRole === null).
     */
    function setupNewAssignmentMocks(eventTitle: string, newSlot: string) {
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(emptyRoster);

      mockDb.select
        // 1. Event exists
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: eventTitle }]),
            }),
          }),
        })
        // 2. Get signups
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        // 3. Get old assignments — empty, so this is a brand-new assignment
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      return service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: newSlot as never,
            position: 1,
            isOverride: false,
          },
        ],
      });
    }

    it('uses generic "assigned to the roster" message when newRole is player', async () => {
      await setupNewAssignmentMocks('Phasmophobia Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the roster for Phasmophobia Night",
        }),
      );
    });

    it('does NOT include "Player role" wording when newRole is player', async () => {
      await setupNewAssignmentMocks('Phasmophobia Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      const call = (
        mockNotificationService.create.mock.calls[0] as [{ message: string }]
      )[0];
      expect(call.message).not.toContain('Player role');
      expect(call.message).not.toContain('the Player');
    });

    it('uses role-specific language for tank assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'tank');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Tank role for Mythic Raid",
        }),
      );
    });

    it('uses role-specific language for healer assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'healer');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Healer role for Mythic Raid",
        }),
      );
    });

    it('uses role-specific language for dps assignment', async () => {
      await setupNewAssignmentMocks('Mythic Raid', 'dps');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'roster_reassigned',
          message: "You've been assigned to the Dps role for Mythic Raid",
        }),
      );
    });

    it('passes newRole in payload for both generic and MMO assignments', async () => {
      await setupNewAssignmentMocks('Game Night', 'player');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ newRole: 'player' }),
        }),
      );
    });

    it('does not notify when user already had an assignment (oldRole is set)', async () => {
      // User already had a 'healer' assignment, so this is a role change (not new)
      // notifyNewAssignments should skip this (oldRole !== null)
      jest
        .spyOn(service, 'getRosterWithAssignments')
        .mockResolvedValueOnce(emptyRoster);

      const oldAssignment = {
        id: 10,
        signupId: 1,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      };

      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ ...mockEvent, title: 'Raid' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([oldAssignment]),
          }),
        });

      mockDb.delete.mockReturnValueOnce({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });

      await service.updateRoster(1, 1, true, {
        assignments: [
          {
            userId: 1,
            signupId: 1,
            slot: 'player' as never,
            position: 1,
            isOverride: false,
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      // notifyRoleChanges sends a notification for the role change,
      // but notifyNewAssignments should NOT fire because oldRole is non-null.
      // Neither call should contain 'roster for' (the generic new-assignment phrase).
      const calls = mockNotificationService.create.mock.calls as Array<
        [{ message?: string }]
      >;
      const genericAssignmentCall = calls.find(
        (c) =>
          typeof c[0].message === 'string' &&
          c[0].message.includes('assigned to the roster for'),
      );
      expect(genericAssignmentCall).toBeUndefined();
    });
  });
});
