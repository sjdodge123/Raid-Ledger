import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import {
  createDrizzleMock,
  type MockDb,
} from '../common/testing/drizzle-mock';

describe('EventsService', () => {
  let service: EventsService;
  let mockDb: MockDb;

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: null,
    discordId: '123',
    role: 'member',
  };
  const mockGame = {
    id: 1,
    igdbId: 1234,
    name: 'Valheim',
    slug: 'valheim',
    coverUrl: null,
  };
  const mockEvent = {
    id: 1,
    title: 'Test Event',
    description: 'Test description',
    gameId: '1',
    creatorId: 1,
    duration: [
      new Date('2026-02-10T18:00:00Z'),
      new Date('2026-02-10T20:00:00Z'),
    ] as [Date, Date],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** Joined row shape returned by findOne / findAll queries */
  const defaultRow = {
    events: mockEvent,
    users: mockUser,
    games: mockGame,
    signupCount: 0,
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    // Default terminal resolvers
    mockDb.returning.mockResolvedValue([mockEvent]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: AvailabilityService,
          useValue: {
            findForUsersInRange: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: NotificationService,
          useValue: { create: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('create', () => {
    it('should create an event and return it with creator info', async () => {
      // returning → new event row, limit → findOne joined row
      mockDb.limit.mockResolvedValueOnce([defaultRow]);

      const dto = {
        title: 'New Event',
        description: 'Description',
        startTime: '2026-02-10T18:00:00Z',
        endTime: '2026-02-10T20:00:00Z',
        gameId: 1,
      };

      const result = await service.create(1, dto);

      expect(result).toMatchObject({
        id: expect.any(Number),
        title: expect.any(String),
        creator: expect.objectContaining({ username: expect.any(String) }),
      });
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return an event with creator info', async () => {
      mockDb.limit.mockResolvedValueOnce([defaultRow]);

      const result = await service.findOne(1);

      expect(result).toMatchObject({
        id: expect.any(Number),
        creator: expect.objectContaining({ username: expect.any(String) }),
      });
    });

    it('should throw NotFoundException when event not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update when user is creator', async () => {
      mockDb.limit
        .mockResolvedValueOnce([mockEvent]) // ownership check
        .mockResolvedValueOnce([defaultRow]); // findOne after update

      const result = await service.update(1, 1, false, {
        title: 'Updated Title',
      });

      expect(result).toMatchObject({ id: expect.any(Number) });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update when user is admin', async () => {
      mockDb.limit
        .mockResolvedValueOnce([mockEvent]) // ownership check
        .mockResolvedValueOnce([defaultRow]); // findOne after update

      const result = await service.update(1, 999, true, {
        title: 'Updated Title',
      });

      expect(result).toMatchObject({ id: expect.any(Number) });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not creator or admin', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // ownership check (creatorId: 1)

      await expect(
        service.update(1, 999, false, { title: 'Updated Title' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when user is creator', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // ownership check

      await service.delete(1, 1, false);

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not creator or admin', async () => {
      mockDb.limit.mockResolvedValueOnce([mockEvent]); // ownership check (creatorId: 1)

      await expect(service.delete(1, 999, false)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
