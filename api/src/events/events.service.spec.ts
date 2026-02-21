import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';

describe('EventsService', () => {
  let service: EventsService;
  let mockDb: Record<string, jest.Mock>;

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

  beforeEach(async () => {
    // Mock database operations
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    // Setup default chain returns
    const defaultRow = {
      events: mockEvent,
      users: mockUser,
      games: mockGame,
      gameRegistry: null,
      signupCount: 0,
    };

    const selectChain = {
      from: jest.fn().mockImplementation(() => {
        // Return a chain that supports both 3-leftJoin (findOne) and 4-leftJoin (findAll/findByIds)
        // plus groupBy for subquery construction, and where for raw selects
        return {
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                // 3 leftJoins: findOne path
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([defaultRow]),
                }),
                // 4 leftJoins: findAll/findByIds path
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([defaultRow]),
                  }),
                  orderBy: jest.fn().mockReturnValue({
                    limit: jest.fn().mockReturnValue({
                      offset: jest.fn().mockResolvedValue([defaultRow]),
                    }),
                  }),
                  $dynamic: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnThis(),
                    orderBy: jest.fn().mockReturnValue({
                      limit: jest.fn().mockReturnValue({
                        offset: jest.fn().mockResolvedValue([defaultRow]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          groupBy: jest.fn().mockReturnValue({
            as: jest.fn().mockReturnValue({ count: 0, eventId: 1 }),
          }),
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              as: jest.fn().mockReturnValue({ count: 0, eventId: 1 }),
            }),
            limit: jest.fn().mockResolvedValue([mockEvent]),
          }),
        };
      }),
    };
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = {
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockEvent]),
      }),
    };
    mockDb.insert.mockReturnValue(insertChain);

    const updateChain = {
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    };
    mockDb.update.mockReturnValue(updateChain);

    const deleteChain = {
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.delete.mockReturnValue(deleteChain);

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
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an event', async () => {
      const dto = {
        title: 'New Event',
        description: 'Description',
        startTime: '2026-02-10T18:00:00Z',
        endTime: '2026-02-10T20:00:00Z',
        gameId: 1,
      };

      const result = await service.create(1, dto);

      expect(result.id).toBe(mockEvent.id);
      expect(result.title).toBe(mockEvent.title);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return an event when found', async () => {
      const result = await service.findOne(1);

      expect(result.id).toBe(mockEvent.id);
      expect(result.creator.username).toBe(mockUser.username);
    });

    it('should throw NotFoundException when event not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      });

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update when user is creator', async () => {
      const dto = { title: 'Updated Title' };

      const result = await service.update(1, 1, false, dto);

      expect(result.id).toBe(mockEvent.id);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update when user is admin', async () => {
      const dto = { title: 'Updated Title' };

      const result = await service.update(1, 999, true, dto);

      expect(result.id).toBe(mockEvent.id);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not creator or admin', async () => {
      const dto = { title: 'Updated Title' };

      await expect(service.update(1, 999, false, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete', () => {
    it('should delete when user is creator', async () => {
      await service.delete(1, 1, false);

      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not creator or admin', async () => {
      await expect(service.delete(1, 999, false)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
