/**
 * Tests for signups-roster.service.ts — event emission timing (ROK-824).
 *
 * Verifies that event emissions happen AFTER DB operations complete,
 * and that roster update operations use transactions for atomicity.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsRosterService } from './signups-roster.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';

describe('SignupsRosterService — emit timing (ROK-824)', () => {
  let service: SignupsRosterService;
  let mockDb: Record<string, jest.Mock>;
  let mockEventEmitter: { emit: jest.Mock };
  let callOrder: string[];

  const mockEvent = {
    id: 1,
    title: 'Test Event',
    creatorId: 99,
  };

  function makeSelectChain(rows: unknown[] = []) {
    return {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    };
  }

  beforeEach(async () => {
    callOrder = [];
    mockEventEmitter = {
      emit: jest.fn().mockImplementation(() => {
        callOrder.push('emit');
      }),
    };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      transaction: jest.fn(),
    };

    // Transaction mock tracks calls
    mockDb.transaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => {
        callOrder.push('tx_start');
        const result = await cb(mockDb);
        callOrder.push('tx_end');
        return result;
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsRosterService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: NotificationService,
          useValue: {
            create: jest.fn().mockResolvedValue(null),
            getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
            resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: RosterNotificationBufferService,
          useValue: { bufferLeave: jest.fn(), bufferJoin: jest.fn() },
        },
        {
          provide: BenchPromotionService,
          useValue: {
            schedulePromotion: jest.fn().mockResolvedValue(undefined),
            cancelPromotion: jest.fn().mockResolvedValue(undefined),
            isEligible: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: SignupsAllocationService,
          useValue: {
            autoAllocateSignup: jest.fn(),
            reslotTentativePlayer: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get(SignupsRosterService);
  });

  describe('updateRoster', () => {
    it('wraps DB operations in a transaction', async () => {
      // Setup: event exists, user is creator
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([{ ...mockEvent, creatorId: 1 }]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ id: 10, eventId: 1, userId: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10 },
      };
      const getRosterFn = jest.fn().mockResolvedValue(mockRoster);

      await service.updateRoster(1, 1, true, { assignments: [] }, getRosterFn);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it('emits event AFTER transaction commits', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([{ ...mockEvent, creatorId: 1 }]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ id: 10, eventId: 1, userId: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10 },
      };
      const getRosterFn = jest.fn().mockResolvedValue(mockRoster);

      await service.updateRoster(1, 1, true, { assignments: [] }, getRosterFn);

      // Verify emit happens AFTER transaction ends
      const txEndIdx = callOrder.indexOf('tx_end');
      const emitIdx = callOrder.indexOf('emit');
      expect(txEndIdx).toBeGreaterThanOrEqual(0);
      expect(emitIdx).toBeGreaterThan(txEndIdx);
    });

    it('emits SIGNUP_EVENTS.UPDATED with roster_updated action', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([{ ...mockEvent, creatorId: 1 }]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ id: 10, eventId: 1, userId: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        });

      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const mockRoster = {
        eventId: 1,
        pool: [],
        assignments: [],
        slots: { player: 10 },
      };
      const getRosterFn = jest.fn().mockResolvedValue(mockRoster);

      await service.updateRoster(1, 1, true, { assignments: [] }, getRosterFn);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SIGNUP_EVENTS.UPDATED,
        expect.objectContaining({
          eventId: 1,
          action: 'roster_updated',
        }),
      );
    });
  });
});
