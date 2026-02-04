import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';

describe('EventsController', () => {
  let controller: EventsController;
  let mockEventsService: Partial<EventsService>;
  let mockSignupsService: Partial<SignupsService>;

  const mockEvent = {
    id: 1,
    title: 'Test Event',
    description: 'Description',
    startTime: '2026-02-10T18:00:00.000Z',
    endTime: '2026-02-10T20:00:00.000Z',
    creator: { id: 1, username: 'testuser', avatar: null },
    game: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  const mockSignup = {
    id: 1,
    eventId: 1,
    user: { id: 1, username: 'testuser', avatar: null },
    note: null,
    signedUpAt: '2026-02-01T00:00:00.000Z',
  };

  const mockUser = { id: 1, isAdmin: false };

  beforeEach(async () => {
    mockEventsService = {
      create: jest.fn().mockResolvedValue(mockEvent),
      findAll: jest.fn().mockResolvedValue({
        data: [mockEvent],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      }),
      findOne: jest.fn().mockResolvedValue(mockEvent),
      update: jest.fn().mockResolvedValue(mockEvent),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockSignupsService = {
      signup: jest.fn().mockResolvedValue(mockSignup),
      cancel: jest.fn().mockResolvedValue(undefined),
      getRoster: jest
        .fn()
        .mockResolvedValue({ eventId: 1, signups: [mockSignup], count: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: EventsService, useValue: mockEventsService },
        { provide: SignupsService, useValue: mockSignupsService },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create event with valid data', async () => {
      const body = {
        title: 'New Event',
        startTime: '2026-02-10T18:00:00.000Z',
        endTime: '2026-02-10T20:00:00.000Z',
      };

      const result = await controller.create({ user: mockUser } as any, body);

      expect(result.id).toBe(mockEvent.id);
      expect(mockEventsService.create).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(Object),
      );
    });

    it('should auto-signup creator on event creation (AC-5)', async () => {
      const body = {
        title: 'New Event',
        startTime: '2026-02-10T18:00:00.000Z',
        endTime: '2026-02-10T20:00:00.000Z',
      };

      await controller.create({ user: mockUser } as any, body);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        mockEvent.id,
        mockUser.id,
      );
    });

    it('should throw BadRequestException for invalid data', async () => {
      const body = { title: '' }; // Missing required times

      await expect(
        controller.create({ user: mockUser } as any, body),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when end before start', async () => {
      const body = {
        title: 'Event',
        startTime: '2026-02-10T20:00:00.000Z',
        endTime: '2026-02-10T18:00:00.000Z', // End before start
      };

      await expect(
        controller.create({ user: mockUser } as any, body),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return paginated events', async () => {
      const result = await controller.findAll({});

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should pass query params to service', async () => {
      await controller.findAll({ page: '2', limit: '10', upcoming: 'true' });

      expect(mockEventsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10, upcoming: 'true' }),
      );
    });
  });

  describe('findOne', () => {
    it('should return single event', async () => {
      const result = await controller.findOne(1);

      expect(result.id).toBe(mockEvent.id);
      expect(mockEventsService.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('update', () => {
    it('should update event with valid data', async () => {
      const body = { title: 'Updated Title' };

      const result = await controller.update(
        1,
        { user: mockUser } as any,
        body,
      );

      expect(result.id).toBe(mockEvent.id);
      expect(mockEventsService.update).toHaveBeenCalledWith(
        1,
        mockUser.id,
        mockUser.isAdmin,
        expect.any(Object),
      );
    });
  });

  describe('delete', () => {
    it('should delete event', async () => {
      const result = await controller.delete(1, { user: mockUser } as any);

      expect(result.message).toBe('Event deleted successfully');
      expect(mockEventsService.delete).toHaveBeenCalledWith(
        1,
        mockUser.id,
        mockUser.isAdmin,
      );
    });
  });

  describe('confirmSignup (ROK-131)', () => {
    const validCharacterId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const mockConfirmedSignup = {
      ...mockSignup,
      characterId: validCharacterId,
      character: {
        id: validCharacterId,
        name: 'Frostweaver',
        class: 'Mage',
        spec: 'Arcane',
        role: 'dps',
        isMain: true,
        itemLevel: 485,
        avatarUrl: null,
      },
      confirmationStatus: 'confirmed',
    };

    beforeEach(() => {
      mockSignupsService.confirmSignup = jest
        .fn()
        .mockResolvedValue(mockConfirmedSignup);
    });

    it('should confirm signup with valid character', async () => {
      const body = { characterId: validCharacterId };

      const result = await controller.confirmSignup(
        1,
        1,
        { user: mockUser } as any,
        body,
      );

      expect(result.characterId).toBe(validCharacterId);
      expect(result.confirmationStatus).toBe('confirmed');
      expect(mockSignupsService.confirmSignup).toHaveBeenCalledWith(
        1,
        1,
        mockUser.id,
        expect.objectContaining({ characterId: validCharacterId }),
      );
    });

    it('should throw BadRequestException for invalid characterId', async () => {
      const body = { characterId: 'not-a-uuid' };

      await expect(
        controller.confirmSignup(1, 1, { user: mockUser } as any, body),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing characterId', async () => {
      const body = {};

      await expect(
        controller.confirmSignup(1, 1, { user: mockUser } as any, body),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getRosterAvailability (ROK-113)', () => {
    const mockRosterAvailability = {
      eventId: 1,
      timeRange: {
        start: '2026-02-10T16:00:00.000Z',
        end: '2026-02-10T22:00:00.000Z',
      },
      users: [
        {
          id: 1,
          username: 'testuser',
          avatar: null,
          slots: [
            {
              start: '2026-02-10T17:00:00.000Z',
              end: '2026-02-10T21:00:00.000Z',
              status: 'available',
              gameId: null,
              sourceEventId: null,
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      mockEventsService.getRosterAvailability = jest
        .fn()
        .mockResolvedValue(mockRosterAvailability);
    });

    it('should return roster availability for event', async () => {
      const result = await controller.getRosterAvailability(1, {});

      expect(result.eventId).toBe(1);
      expect(result.users).toHaveLength(1);
      expect(mockEventsService.getRosterAvailability).toHaveBeenCalledWith(
        1,
        undefined,
        undefined,
      );
    });

    it('should pass query params to service', async () => {
      const query = {
        from: '2026-02-10T16:00:00.000Z',
        to: '2026-02-10T22:00:00.000Z',
      };

      await controller.getRosterAvailability(1, query);

      expect(mockEventsService.getRosterAvailability).toHaveBeenCalledWith(
        1,
        query.from,
        query.to,
      );
    });
  });
});
