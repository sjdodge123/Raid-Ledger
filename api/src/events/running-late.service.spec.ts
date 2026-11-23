import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import { RunningLateService } from './running-late.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { NotificationService } from '../notifications/notification.service';

describe('RunningLateService (ROK-1379)', () => {
  let service: RunningLateService;
  let mockDb: MockDb;
  let emit: jest.Mock;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    emit = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        RunningLateService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventEmitter2, useValue: { emit } },
        {
          provide: NotificationService,
          useValue: {
            createMany: jest.fn().mockResolvedValue(undefined),
            getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
            resolveVoiceForEvent: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();
    service = module.get(RunningLateService);
  });

  describe('setRunningLate', () => {
    it('marks the attendee late and reports the change', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      const changed = await service.setRunningLate(1, 7);
      expect(changed).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ runningLateAt: expect.any(Date) }),
      );
    });

    it('is a no-op when no signup row matches (already late or host with no signup)', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      const changed = await service.setRunningLate(1, 7);
      expect(changed).toBe(false);
    });

    it('is idempotent — a second call updates nothing', async () => {
      mockDb.returning
        .mockResolvedValueOnce([{ id: 42 }])
        .mockResolvedValueOnce([]);
      expect(await service.setRunningLate(1, 7)).toBe(true);
      expect(await service.setRunningLate(1, 7)).toBe(false);
    });
  });

  describe('clearRunningLate', () => {
    it('clears the marker and reports the change', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      const changed = await service.clearRunningLate(1, 7);
      expect(changed).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ runningLateAt: null, lateMinutes: null }),
      );
    });

    it('is a no-op when not currently late', async () => {
      mockDb.returning.mockResolvedValueOnce([]);
      expect(await service.clearRunningLate(1, 7)).toBe(false);
    });
  });

  describe('ROK-2271 C4: announces the change for the event thread', () => {
    it('a real late mark emits ONE urgent signup update', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      await service.setRunningLate(1, 7, 15);
      expect(emit.mock.calls).toEqual([
        [
          SIGNUP_EVENTS.UPDATED,
          { eventId: 1, userId: 7, action: 'running_late', urgent: true },
        ],
      ]);
    });

    it('a real clear emits an urgent "cleared" update', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);
      await service.clearRunningLate(1, 7);
      expect(emit.mock.calls).toEqual([
        [
          SIGNUP_EVENTS.UPDATED,
          {
            eventId: 1,
            userId: 7,
            action: 'running_late_cleared',
            urgent: true,
          },
        ],
      ]);
    });

    it('a no-op (already late / not late) emits nothing', async () => {
      mockDb.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.setRunningLate(1, 7);
      await service.clearRunningLate(1, 7);
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
