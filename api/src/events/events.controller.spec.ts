import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { AttendanceService } from './attendance.service';
import { PugsService } from './pugs.service';
import { ShareService } from './share.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole };
}

describe('EventsController', () => {
  let controller: EventsController;
  let mockEventsService: Partial<EventsService>;
  let mockSignupsService: Partial<SignupsService>;
  let mockPugsService: Partial<PugsService>;

  const mockEvent = {
    id: 1,
    title: 'Test Event',
    description: 'Description',
    startTime: '2026-02-10T18:00:00.000Z',
    endTime: '2026-02-10T20:00:00.000Z',
    creator: {
      id: 1,
      discordId: '123456789',
      username: 'testuser',
      avatar: null,
    },
    game: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  const mockSignup = {
    id: 1,
    eventId: 1,
    user: { id: 1, discordId: '123456789', username: 'testuser', avatar: null },
    note: null,
    signedUpAt: '2026-02-01T00:00:00.000Z',
  };

  const mockUser = { id: 1, role: 'member' as UserRole };

  beforeEach(async () => {
    mockEventsService = {
      create: jest.fn().mockResolvedValue(mockEvent),
      findAll: jest.fn().mockResolvedValue({
        data: [mockEvent],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false },
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

    mockPugsService = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue({ pugs: [] }),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        { provide: EventsService, useValue: mockEventsService },
        { provide: SignupsService, useValue: mockSignupsService },
        {
          provide: AttendanceService,
          useValue: {
            recordAttendance: jest.fn().mockResolvedValue({}),
            getAttendanceSummary: jest.fn().mockResolvedValue({
              eventId: 1,
              totalSignups: 0,
              attended: 0,
              noShow: 0,
              excused: 0,
              unmarked: 0,
              attendanceRate: 0,
              noShowRate: 0,
              signups: [],
            }),
          },
        },
        { provide: PugsService, useValue: mockPugsService },
        {
          provide: ShareService,
          useValue: {
            shareToDiscordChannels: jest
              .fn()
              .mockResolvedValue({ channelsPosted: 0, channelsSkipped: 0 }),
          },
        },
        {
          provide: AdHocEventService,
          useValue: {
            getAdHocRoster: jest.fn().mockResolvedValue({
              eventId: 1,
              participants: [],
              activeCount: 0,
            }),
          },
        },
        {
          provide: VoiceAttendanceService,
          useValue: {
            getVoiceSessions: jest.fn().mockResolvedValue({
              eventId: 1,
              sessions: [],
            }),
            getVoiceAttendanceSummary: jest.fn().mockResolvedValue({
              eventId: 1,
              totalTracked: 0,
              full: 0,
              partial: 0,
              late: 0,
              earlyLeaver: 0,
              noShow: 0,
              unclassified: 0,
              sessions: [],
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
  });

  describe('create', () => {
    it('should create event with valid data', async () => {
      const body = {
        title: 'New Event',
        startTime: '2026-02-10T18:00:00.000Z',
        endTime: '2026-02-10T20:00:00.000Z',
      };

      const result = await controller.create(
        { user: mockUser } as AuthenticatedRequest,
        body,
      );

      expect(result).toMatchObject({ id: expect.any(Number) });
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

      await controller.create({ user: mockUser } as AuthenticatedRequest, body);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        mockEvent.id,
        mockUser.id,
      );
    });

    it('should throw BadRequestException for invalid data', async () => {
      const body = { title: '' }; // Missing required times

      await expect(
        controller.create({ user: mockUser } as AuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when end before start', async () => {
      const body = {
        title: 'Event',
        startTime: '2026-02-10T20:00:00.000Z',
        endTime: '2026-02-10T18:00:00.000Z', // End before start
      };

      await expect(
        controller.create({ user: mockUser } as AuthenticatedRequest, body),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    const mockReq = { user: undefined } as {
      user?: { id: number; role: UserRole };
    };
    const authedReq = { user: { id: 1, role: 'member' as UserRole } };

    it('should return paginated events', async () => {
      const result = await controller.findAll({}, mockReq);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should pass query params to service', async () => {
      await controller.findAll(
        { page: '2', limit: '10', upcoming: 'true' },
        mockReq,
      );

      expect(mockEventsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10, upcoming: 'true' }),
        undefined,
      );
    });

    it('should pass authenticated userId to service (ROK-213)', async () => {
      await controller.findAll({}, authedReq);

      expect(mockEventsService.findAll).toHaveBeenCalledWith(
        expect.any(Object),
        1,
      );
    });

    // ROK-174: Date Range Filtering Tests
    describe('date range filtering (ROK-174)', () => {
      it('should pass startAfter query param to service', async () => {
        const startAfter = '2026-02-01T00:00:00.000Z';
        await controller.findAll({ startAfter }, mockReq);

        expect(mockEventsService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({ startAfter }),
          undefined,
        );
      });

      it('should pass endBefore query param to service', async () => {
        const endBefore = '2026-02-28T23:59:59.000Z';
        await controller.findAll({ endBefore }, mockReq);

        expect(mockEventsService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({ endBefore }),
          undefined,
        );
      });

      it('should pass both startAfter and endBefore for range queries', async () => {
        const startAfter = '2026-02-01T00:00:00.000Z';
        const endBefore = '2026-02-28T23:59:59.000Z';
        await controller.findAll({ startAfter, endBefore }, mockReq);

        expect(mockEventsService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({ startAfter, endBefore }),
          undefined,
        );
      });

      it('should pass gameId filter to service', async () => {
        const gameId = '123';
        await controller.findAll({ gameId }, mockReq);

        expect(mockEventsService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({ gameId }),
          undefined,
        );
      });

      it('should combine date range with other filters', async () => {
        const query = {
          startAfter: '2026-02-01T00:00:00.000Z',
          endBefore: '2026-02-28T23:59:59.000Z',
          gameId: '123',
          upcoming: 'true',
          page: '1',
          limit: '50',
        };
        await controller.findAll(query, mockReq);

        expect(mockEventsService.findAll).toHaveBeenCalledWith(
          expect.objectContaining({
            startAfter: '2026-02-01T00:00:00.000Z',
            endBefore: '2026-02-28T23:59:59.000Z',
            gameId: '123',
            upcoming: 'true',
            page: 1,
            limit: 50,
          }),
          undefined,
        );
      });

      it('should throw BadRequestException for invalid startAfter date format', async () => {
        await expect(
          controller.findAll({ startAfter: 'not-a-date' }, mockReq),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for invalid endBefore date format', async () => {
        await expect(
          controller.findAll({ endBefore: 'invalid-date' }, mockReq),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when startAfter is after endBefore', async () => {
        await expect(
          controller.findAll(
            {
              startAfter: '2026-02-28T00:00:00.000Z',
              endBefore: '2026-02-01T00:00:00.000Z', // Before startAfter
            },
            mockReq,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('findOne', () => {
    it('should return single event', async () => {
      const result = await controller.findOne(1);

      expect(result).toMatchObject({ id: expect.any(Number) });
      expect(mockEventsService.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('update', () => {
    it('should update event with valid data', async () => {
      const body = { title: 'Updated Title' };

      const result = await controller.update(
        1,
        { user: mockUser } as AuthenticatedRequest,
        body,
      );

      expect(result).toMatchObject({ id: expect.any(Number) });
      expect(mockEventsService.update).toHaveBeenCalledWith(
        1,
        mockUser.id,
        false,
        expect.any(Object),
      );
    });
  });

  describe('delete', () => {
    it('should delete event', async () => {
      const result = await controller.delete(1, {
        user: mockUser,
      } as AuthenticatedRequest);

      expect(result.message).toBe('Event deleted successfully');
      expect(mockEventsService.delete).toHaveBeenCalledWith(
        1,
        mockUser.id,
        false,
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
        { user: mockUser } as AuthenticatedRequest,
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
        controller.confirmSignup(
          1,
          1,
          { user: mockUser } as AuthenticatedRequest,
          body,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing characterId', async () => {
      const body = {};

      await expect(
        controller.confirmSignup(
          1,
          1,
          { user: mockUser } as AuthenticatedRequest,
          body,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getVoiceSessions ACL (ROK-490)', () => {
    const creatorReq = {
      user: { id: 1, role: 'member' as UserRole },
    } as AuthenticatedRequest;
    const nonCreatorReq = {
      user: { id: 99, role: 'member' as UserRole },
    } as AuthenticatedRequest;
    const operatorReq = {
      user: { id: 99, role: 'operator' as UserRole },
    } as AuthenticatedRequest;
    const adminReq = {
      user: { id: 99, role: 'admin' as UserRole },
    } as AuthenticatedRequest;

    it('should allow event creator to view voice sessions', async () => {
      const result = await controller.getVoiceSessions(1, creatorReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should allow operator to view voice sessions', async () => {
      const result = await controller.getVoiceSessions(1, operatorReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should allow admin to view voice sessions', async () => {
      const result = await controller.getVoiceSessions(1, adminReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should throw ForbiddenException for non-creator member', async () => {
      await expect(
        controller.getVoiceSessions(1, nonCreatorReq),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getVoiceAttendance ACL (ROK-490)', () => {
    const creatorReq = {
      user: { id: 1, role: 'member' as UserRole },
    } as AuthenticatedRequest;
    const nonCreatorReq = {
      user: { id: 99, role: 'member' as UserRole },
    } as AuthenticatedRequest;
    const operatorReq = {
      user: { id: 99, role: 'operator' as UserRole },
    } as AuthenticatedRequest;
    const adminReq = {
      user: { id: 99, role: 'admin' as UserRole },
    } as AuthenticatedRequest;

    it('should allow event creator to view voice attendance', async () => {
      const result = await controller.getVoiceAttendance(1, creatorReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should allow operator to view voice attendance', async () => {
      const result = await controller.getVoiceAttendance(1, operatorReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should allow admin to view voice attendance', async () => {
      const result = await controller.getVoiceAttendance(1, adminReq);
      expect(result).toMatchObject({ eventId: 1 });
    });

    it('should throw ForbiddenException for non-creator member', async () => {
      await expect(
        controller.getVoiceAttendance(1, nonCreatorReq),
      ).rejects.toThrow(ForbiddenException);
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
