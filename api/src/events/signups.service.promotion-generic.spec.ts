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

describe('SignupsService — promotion', () => {
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
        {
          provide: ActivityLogService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            getTimeline: jest.fn().mockResolvedValue({ data: [] }),
          },
        },
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

    const genericSlotConfig = {
      type: 'generic',
      player: 10,
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

    it('returns null when event has no slotConfig', async () => {
      // event.slotConfig is null
      mockDb.select.mockReturnValueOnce(
        makeSelectChain([{ slotConfig: null }]),
      );

      const result = await service.promoteFromBench(1, 1);

      expect(result).toBeNull();
    });

    it('returns null when event is not found', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));

      const result = await service.promoteFromBench(1, 1);

      expect(result).toBeNull();
    });

    it('returns null when signup is not found', async () => {
      // event found with MMO slot config
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
        // signup not found
        .mockReturnValueOnce(makeSelectChain([]));

      const result = await service.promoteFromBench(1, 99);

      expect(result).toBeNull();
    });

    describe('generic event promotion', () => {
      it('promotes bench player to first open player slot', async () => {
        // event with generic config
        mockDb.select
          .mockReturnValueOnce(
            makeSelectChain([{ slotConfig: genericSlotConfig }]),
          )
          // signup
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: null, userId: 1 }]),
          )
          // username
          .mockReturnValueOnce(makeSelectChain([{ username: 'HeroPlayer' }]));

        // promoteGenericSlot: delete bench assignment, then select current players
        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.select.mockReturnValueOnce(
          makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
        );

        // insert player assignment
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

        // update signup to confirmed
        mockDb.update.mockReturnValueOnce({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result).toMatchObject({
          role: 'player',
          username: 'HeroPlayer',
        });
        expect(result?.position).toBeGreaterThan(0);
        expect(result?.warning).toBeUndefined();
      });

      it('returns bench result with warning when all player slots are full', async () => {
        const fullConfig = { type: 'generic', player: 2, bench: 5 };

        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: fullConfig }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: null, userId: 1 }]),
          )
          .mockReturnValueOnce(
            makeSelectChain([{ username: 'BenchedPlayer' }]),
          );

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockResolvedValue(undefined),
        });
        // 2 players already in slots (at capacity of 2)
        mockDb.select.mockReturnValueOnce(
          makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
        );

        // re-insert back to bench
        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result).toMatchObject({
          role: 'bench',
          position: 1,
          username: 'BenchedPlayer',
        });
        expect(result?.warning).toMatch(/All player slots are full/);
      });

      it('fills gap in player positions rather than always appending', async () => {
        const config = { type: 'generic', player: 5, bench: 5 };

        mockDb.select
          .mockReturnValueOnce(makeSelectChain([{ slotConfig: config }]))
          .mockReturnValueOnce(
            makeSelectChain([{ preferredRoles: null, userId: 1 }]),
          )
          .mockReturnValueOnce(makeSelectChain([{ username: 'GapFiller' }]));

        mockDb.delete.mockReturnValueOnce({
          where: jest.fn().mockResolvedValue(undefined),
        });
        // Positions 1 and 3 occupied — gap at 2
        mockDb.select.mockReturnValueOnce(
          makeSelectChainNoLimit([{ position: 1 }, { position: 3 }]),
        );

        mockDb.insert.mockReturnValueOnce({
          values: jest.fn().mockResolvedValue(undefined),
        });
        mockDb.update.mockReturnValueOnce({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(undefined),
          }),
        });

        const result = await service.promoteFromBench(1, 1);

        expect(result?.role).toBe('player');
        expect(result?.position).toBe(2); // should fill the gap
      });
    });
  });
});
