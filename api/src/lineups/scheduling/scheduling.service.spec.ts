/**
 * Unit tests for SchedulingService (ROK-965).
 * Uses flat drizzle-mock; controls results via terminal methods.
 */
import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { EventsService } from '../../events/events.service';

describe('SchedulingService', () => {
  let service: SchedulingService;
  let mockDb: MockDb;
  let mockEventsService: { create: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockEventsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: EventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get(SchedulingService);
  });

  describe('suggestSlot', () => {
    it('inserts a slot and returns its id', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 10, lineupId: 1, gameId: 5 }]);
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);

      const result = await service.suggestSlot(10, '2026-04-01T19:00:00Z');

      expect(result).toMatchObject({ id: expect.any(Number) });
    });

    it('throws NotFoundException for missing match', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(
        service.suggestSlot(999, '2026-04-01T19:00:00Z'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleVote', () => {
    it('creates a vote when none exists', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValueOnce([
        { id: 1, slotId: 5, userId: 10 },
      ]);

      const result = await service.toggleVote(5, 10);

      expect(result).toEqual({ voted: true });
    });

    it('removes existing vote on toggle off', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);

      const result = await service.toggleVote(5, 10);

      expect(result).toEqual({ voted: false });
    });
  });

  describe('createEventFromSlot', () => {
    it('throws when match already has linked event', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 10, linkedEventId: 50 }]);

      await expect(service.createEventFromSlot(10, 20, 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for missing match', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.createEventFromSlot(999, 20, 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('passes recurrence to EventsService when recurring is true', async () => {
      const slotTime = '2026-04-01T19:00:00.000Z';
      // findMatchById
      mockDb.limit.mockResolvedValueOnce([
        { id: 10, lineupId: 1, gameId: 5, linkedEventId: null },
      ]);
      // slot lookup
      mockDb.limit.mockResolvedValueOnce([
        { id: 20, matchId: 10, proposedTime: slotTime },
      ]);
      // resolveGameName -> resolveGameInfo
      mockDb.limit.mockResolvedValueOnce([
        { name: 'Test Game', coverUrl: null },
      ]);
      mockEventsService.create.mockResolvedValueOnce({ id: 100 });

      await service.createEventFromSlot(10, 20, 1, true);

      expect(mockEventsService.create).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          recurrence: expect.objectContaining({
            frequency: 'weekly',
          }),
        }),
      );
    });

    it('does not pass recurrence when recurring is false', async () => {
      const slotTime = '2026-04-01T19:00:00.000Z';
      mockDb.limit.mockResolvedValueOnce([
        { id: 10, lineupId: 1, gameId: 5, linkedEventId: null },
      ]);
      mockDb.limit.mockResolvedValueOnce([
        { id: 20, matchId: 10, proposedTime: slotTime },
      ]);
      mockDb.limit.mockResolvedValueOnce([
        { name: 'Test Game', coverUrl: null },
      ]);
      mockEventsService.create.mockResolvedValueOnce({ id: 101 });

      await service.createEventFromSlot(10, 20, 1, false);

      const createArg = mockEventsService.create.mock.calls[0][1];
      expect(createArg.recurrence).toBeUndefined();
    });
  });

  describe('retractAllVotes', () => {
    it('calls delete for all user votes on a match', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await service.retractAllVotes(10, 1);

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
