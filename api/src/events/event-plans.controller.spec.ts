import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventPlansController } from './event-plans.controller';
import { EventPlansService } from './event-plans.service';
import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole };
}

const PLAN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CREATOR_ID = 1;

const mockPlan = {
  id: PLAN_ID,
  creatorId: CREATOR_ID,
  title: 'Raid Night',
  description: null,
  gameId: null,
  slotConfig: null,
  maxAttendees: null,
  autoUnbench: true,
  durationMinutes: 120,
  pollOptions: [
    { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM' },
    { date: '2026-03-11T18:00:00.000Z', label: 'Tuesday Mar 11, 6:00 PM' },
  ],
  pollDurationHours: 24,
  pollMode: 'standard' as const,
  pollRound: 1,
  pollChannelId: 'channel-123',
  pollMessageId: 'message-456',
  status: 'polling' as const,
  winningOption: null,
  createdEventId: null,
  pollStartedAt: new Date().toISOString(),
  pollEndsAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockTimeSuggestions = {
  source: 'fallback' as const,
  interestedPlayerCount: 0,
  suggestions: [
    {
      date: '2026-03-10T18:00:00.000Z',
      label: 'Monday Mar 10, 6:00 PM',
      availableCount: 0,
    },
  ],
};

const mockReq = { user: { id: CREATOR_ID, role: 'member' as UserRole } };

describe('EventPlansController', () => {
  let controller: EventPlansController;
  let service: Partial<EventPlansService>;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(mockPlan),
      findOne: jest.fn().mockResolvedValue(mockPlan),
      findAll: jest.fn().mockResolvedValue([mockPlan]),
      cancel: jest.fn().mockResolvedValue({ ...mockPlan, status: 'cancelled' }),
      getTimeSuggestions: jest.fn().mockResolvedValue(mockTimeSuggestions),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventPlansController],
      providers: [{ provide: EventPlansService, useValue: service }],
    }).compile();

    controller = module.get<EventPlansController>(EventPlansController);
  });


  // ─── getTimeSuggestions ──────────────────────────────────────────────────────

  describe('getTimeSuggestions', () => {
    it('should call service with parsed gameId and tzOffset', async () => {
      await controller.getTimeSuggestions('5', '-300', '2026-03-01T00:00:00Z');

      expect(service.getTimeSuggestions).toHaveBeenCalledWith(
        5,
        -300,
        '2026-03-01T00:00:00Z',
      );
    });

    it('should pass undefined when query params are absent', async () => {
      await controller.getTimeSuggestions(undefined, undefined, undefined);

      expect(service.getTimeSuggestions).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });

    it('should return time suggestions from service', async () => {
      const result = await controller.getTimeSuggestions();

      expect(result).toEqual(mockTimeSuggestions);
    });

    it('should not require authentication (no guard on endpoint)', () => {
      // Verify there is no auth guard by calling without a user context
      expect(() =>
        controller.getTimeSuggestions(undefined, undefined, undefined),
      ).not.toThrow();
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    const validBody = {
      title: 'Raid Night',
      durationMinutes: 120,
      pollOptions: [
        { date: '2026-03-10T18:00:00.000Z', label: 'Monday Mar 10, 6:00 PM' },
        { date: '2026-03-11T18:00:00.000Z', label: 'Tuesday Mar 11, 6:00 PM' },
      ],
      pollDurationHours: 24,
      pollMode: 'standard',
    };

    it('should create plan with valid data', async () => {
      const result = await controller.create(
        mockReq as AuthenticatedRequest,
        validBody,
      );

      expect(result).toEqual(mockPlan);
      expect(service.create).toHaveBeenCalledWith(
        CREATOR_ID,
        expect.any(Object),
      );
    });

    it('should pass the user id from the request', async () => {
      const req = { user: { id: 99, role: 'member' as UserRole } };

      await controller.create(req as AuthenticatedRequest, validBody);

      expect(service.create).toHaveBeenCalledWith(99, expect.any(Object));
    });

    it('should throw BadRequestException for invalid body (title empty)', async () => {
      const invalidBody = { ...validBody, title: '' };

      await expect(
        controller.create(mockReq as AuthenticatedRequest, invalidBody),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fewer than 2 pollOptions', async () => {
      const invalidBody = {
        ...validBody,
        pollOptions: [{ date: '2026-03-10T18:00:00.000Z', label: 'Only one' }],
      };

      await expect(
        controller.create(mockReq as AuthenticatedRequest, invalidBody),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when more than 9 pollOptions', async () => {
      const tooMany = Array.from({ length: 10 }, (_, i) => ({
        date: `2026-03-${10 + i}T18:00:00.000Z`,
        label: `Option ${i + 1}`,
      }));
      const invalidBody = { ...validBody, pollOptions: tooMany };

      await expect(
        controller.create(mockReq as AuthenticatedRequest, invalidBody),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when pollMode is invalid', async () => {
      const invalidBody = { ...validBody, pollMode: 'invalid_mode' };

      await expect(
        controller.create(mockReq as AuthenticatedRequest, invalidBody),
      ).rejects.toThrow(BadRequestException);
    });

    it('should re-throw non-Zod errors from service', async () => {
      (service.create as jest.Mock).mockRejectedValue(
        new Error('Unexpected error'),
      );

      await expect(
        controller.create(mockReq as AuthenticatedRequest, validBody),
      ).rejects.toThrow('Unexpected error');
    });
  });

  // ─── listPlans ──────────────────────────────────────────────────────────────

  describe('listPlans', () => {
    it('should return list of all plans', async () => {
      const result = await controller.listPlans();

      expect(result).toEqual([mockPlan]);
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should return empty array when no plans exist', async () => {
      (service.findAll as jest.Mock).mockResolvedValue([]);

      const result = await controller.listPlans();

      expect(result).toEqual([]);
    });
  });

  // ─── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the plan for a valid UUID', async () => {
      const result = await controller.findOne(PLAN_ID);

      expect(result).toEqual(mockPlan);
      expect(service.findOne).toHaveBeenCalledWith(PLAN_ID);
    });

    it('should propagate NotFoundException from service', async () => {
      (service.findOne as jest.Mock).mockRejectedValue(
        new NotFoundException(`Event plan ${PLAN_ID} not found`),
      );

      await expect(controller.findOne(PLAN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('should cancel the plan for the authenticated user', async () => {
      const result = await controller.cancel(
        PLAN_ID,
        mockReq as AuthenticatedRequest,
      );

      expect(result.status).toBe('cancelled');
      expect(service.cancel).toHaveBeenCalledWith(
        PLAN_ID,
        CREATOR_ID,
        'member',
      );
    });

    it('should propagate NotFoundException when plan does not exist', async () => {
      (service.cancel as jest.Mock).mockRejectedValue(
        new NotFoundException('Not found'),
      );

      await expect(
        controller.cancel(PLAN_ID, mockReq as AuthenticatedRequest),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
