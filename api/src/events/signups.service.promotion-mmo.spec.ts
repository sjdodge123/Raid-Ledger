import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

describe('SignupsService — promotion (MMO)', () => {
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
        SignupsAllocationService,
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

  describe('promoteFromBench', () => {
    const mmoSlotConfig = {
      type: 'mmo',
      tank: 2,
      healer: 4,
      dps: 14,
      bench: 5,
    };

    function makeSelectChain(returnValue: unknown) {
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(returnValue),
          }),
        }),
      };
    }

    function makeSelectChainNoLimit(returnValue: unknown) {
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(returnValue),
        }),
      };
    }

    beforeEach(() => {
      // transaction runs the callback with mockDb as the tx
      mockDb.transaction.mockImplementation(
        async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
      );
    });
    describe('MMO event promotion', () => {
      it('uses autoAllocateSignup for MMO events and returns promotion result', async () => {
        mockDb.select
          // 1. event slotConfig
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          // 2. signup
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['dps'], userId: 1 }]),
          )
          // 3. username
          .mockReturnValueOnce(
            makeSelectChain([{ username: 'DragonSlayer99' }]),
          )
          // 4. before snapshot (no non-bench assignments)
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // 5. autoAllocateSignup: all signups
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['dps'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          // 6. autoAllocateSignup: current assignments
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // 7. check new assignment after autoAllocate
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
          // 8. after snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockResolvedValue([
                  { id: 2, signupId: 1, role: 'dps', position: 1 },
                ]),
            }),
          });

        // delete bench assignment
        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        // autoAllocateSignup: insert assignment
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        // autoAllocateSignup: cancelPromotion + update confirmationStatus
        mockDb.update.mockReturnValueOnce({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result).toMatchObject({
          role: 'dps',
          position: 1,
          username: 'DragonSlayer99',
        });
      });

      it('returns bench result with warning when allocation fails for MMO event', async () => {
        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['healer'], userId: 2 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'CasualCarl' }]))
          // before snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // autoAllocateSignup: all signups — signup with no preferred roles won't allocate
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // autoAllocateSignup: current assignments (all healer slots full)
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                { id: 10, signupId: 10, role: 'healer', position: 1 },
                { id: 11, signupId: 11, role: 'healer', position: 2 },
                { id: 12, signupId: 12, role: 'healer', position: 3 },
                { id: 13, signupId: 13, role: 'healer', position: 4 },
              ]),
            }),
          })
          // check new assignment — returns null (no assignment was created)
          .mockReturnValueOnce(makeSelectChain([]));

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        // re-insert back to bench (allocation failed)
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

        const result = await service.promoteFromBench(1, 2);

        expect(result).toMatchObject({
          role: 'bench',
          position: 1,
          username: 'CasualCarl',
        });
        expect(result?.warning).toMatch(
          /Could not find a suitable roster slot/,
        );
      });

      it('includes role mismatch warning when player is placed outside preferred roles', async () => {
        // Player prefers healer only but gets placed in dps due to chain rearrangement
        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['healer'], userId: 1 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'HealerWannabe' }]))
          // before snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // autoAllocateSignup: all signups
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['healer'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          // autoAllocateSignup: current assignments (healer slots full, dps open)
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                { id: 10, signupId: 10, role: 'healer', position: 1 },
                { id: 11, signupId: 11, role: 'healer', position: 2 },
                { id: 12, signupId: 12, role: 'healer', position: 3 },
                { id: 13, signupId: 13, role: 'healer', position: 4 },
              ]),
            }),
          })
          // check new assignment — placed in dps (not preferred)
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
          // after snapshot (same as current)
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockResolvedValue([
                  { id: 20, signupId: 1, role: 'dps', position: 1 },
                ]),
            }),
          });

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        // insert assignment
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.role).toBe('dps');
        expect(result?.warning).toMatch(/not in their preferred roles/);
        expect(result?.warning).toMatch(/healer/);
      });

      it('includes chain move details when other players are rearranged', async () => {
        // signupId=1 is being promoted. signupId=2 was moved from dps to healer.
        const beforeSnapshot = [
          { id: 5, signupId: 2, role: 'dps', position: 1 },
        ];
        const afterSnapshot = [
          { id: 5, signupId: 2, role: 'healer', position: 1 },
          { id: 6, signupId: 1, role: 'dps', position: 2 },
        ];

        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['dps'], userId: 1 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'NewGuy' }]))
          // before snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(beforeSnapshot),
            }),
          })
          // autoAllocateSignup: all signups
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['dps'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          // autoAllocateSignup: current assignments
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(beforeSnapshot),
            }),
          })
          // check new assignment
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 2 }]))
          // after snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(afterSnapshot),
            }),
          })
          // detectChainMoves: batch-fetch signups for moved players
          .mockReturnValueOnce(
            makeSelectChainNoLimit([
              { id: 2, userId: 2, discordUsername: null },
            ]),
          )
          // detectChainMoves: batch-fetch users for username fallback
          .mockReturnValueOnce(
            makeSelectChainNoLimit([{ id: 2, username: 'ChainedPlayer' }]),
          );

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.chainMoves).toBeDefined();
        expect(result?.chainMoves?.length).toBeGreaterThan(0);
        expect(result?.chainMoves?.[0]).toMatch(/ChainedPlayer/);
        expect(result?.chainMoves?.[0]).toMatch(/dps.*healer|healer.*dps/);
      });

      it('does not include promoted player in chain moves list', async () => {
        // signupId=1 is promoted. The snapshot should not detect them as a chain move.
        const beforeSnapshot: Array<{
          id: number;
          signupId: number;
          role: string;
          position: number;
        }> = [];
        const afterSnapshot = [
          { id: 6, signupId: 1, role: 'dps', position: 1 },
        ];

        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['dps'], userId: 1 }]),
          )
          .mockReturnValueOnce(
            makeSelectChain([{ username: 'PromotedPlayer' }]),
          )
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(beforeSnapshot),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['dps'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(afterSnapshot),
            }),
          });

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        // The promoted player (signupId=1) must NOT appear as a chain move
        expect(result?.chainMoves).toEqual([]);
        expect(result?.warning).toBeUndefined();
      });

      it('uses discordUsername when RL account is not linked for chain move detection', async () => {
        const beforeSnapshot = [
          { id: 5, signupId: 2, role: 'tank', position: 1 },
        ];
        const afterSnapshot = [
          { id: 5, signupId: 2, role: 'dps', position: 1 },
          { id: 6, signupId: 1, role: 'tank', position: 2 },
        ];

        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['tank'], userId: 1 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'RLUser' }]))
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(beforeSnapshot),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['tank'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(beforeSnapshot),
            }),
          })
          .mockReturnValueOnce(makeSelectChain([{ role: 'tank', position: 2 }]))
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(afterSnapshot),
            }),
          })
          // detectChainMoves: batch-fetch signups for moved players (anonymous, has discordUsername)
          .mockReturnValueOnce(
            makeSelectChainNoLimit([
              { id: 2, userId: null, discordUsername: 'DiscordAnon#1234' },
            ]),
          );

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.chainMoves?.[0]).toMatch(/DiscordAnon#1234/);
      });

      it('returns no warning when preferred role matches assigned role and no chain moves', async () => {
        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['dps'], userId: 1 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'PerfectMatch' }]))
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['dps'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          // assigned to dps (matches preferred role)
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
          // after snapshot
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockResolvedValue([
                  { id: 2, signupId: 1, role: 'dps', position: 1 },
                ]),
            }),
          });

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.role).toBe('dps');
        expect(result?.warning).toBeUndefined();
        expect(result?.chainMoves).toEqual([]);
      });

      it('falls back to username="Bench player" when userId is not set (anonymous signup)', async () => {
        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
          // signup has no userId (anonymous)
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: ['dps'], userId: null }]),
          )
          // no username lookup because userId is null
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  id: 1,
                  preferredRoles: ['dps'],
                  status: 'signed_up',
                  signedUpAt: new Date(),
                },
              ]),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest
                .fn()
                .mockResolvedValue([
                  { id: 2, signupId: 1, role: 'dps', position: 1 },
                ]),
            }),
          });

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.username).toBe('Bench player');
      });
    });
  });
});
