import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventPlansController } from './event-plans.controller';
import { EventPlansService } from './event-plans.service';
import type { UserRole } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';

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

let controller: EventPlansController;
let service: Partial<EventPlansService>;

async function setupEach() {
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
}

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

async function testTimeSuggestionsWithParams() {
  await controller.getTimeSuggestions('5', '-300', '2026-03-01T00:00:00Z');
  expect(service.getTimeSuggestions).toHaveBeenCalledWith(
    5,
    -300,
    '2026-03-01T00:00:00Z',
  );
}

async function testTimeSuggestionsUndefinedParams() {
  await controller.getTimeSuggestions(undefined, undefined, undefined);
  expect(service.getTimeSuggestions).toHaveBeenCalledWith(
    undefined,
    undefined,
    undefined,
  );
}

async function testTimeSuggestionsReturnsResult() {
  const result = await controller.getTimeSuggestions();
  expect(result).toEqual(mockTimeSuggestions);
}

function testTimeSuggestionsNoAuth() {
  expect(() =>
    controller.getTimeSuggestions(undefined, undefined, undefined),
  ).not.toThrow();
}

async function testCreateWithValidData() {
  const result = await controller.create(
    mockReq as AuthenticatedRequest,
    validBody,
  );
  expect(result).toEqual(mockPlan);
  expect(service.create).toHaveBeenCalledWith(CREATOR_ID, expect.any(Object));
}

async function testCreatePassesUserId() {
  const req = { user: { id: 99, role: 'member' as UserRole } };
  await controller.create(req as AuthenticatedRequest, validBody);
  expect(service.create).toHaveBeenCalledWith(99, expect.any(Object));
}

async function testCreateEmptyTitle() {
  const invalidBody = { ...validBody, title: '' };
  await expect(
    controller.create(mockReq as AuthenticatedRequest, invalidBody),
  ).rejects.toThrow(BadRequestException);
}

async function testCreateTooFewOptions() {
  const invalidBody = {
    ...validBody,
    pollOptions: [{ date: '2026-03-10T18:00:00.000Z', label: 'Only one' }],
  };
  await expect(
    controller.create(mockReq as AuthenticatedRequest, invalidBody),
  ).rejects.toThrow(BadRequestException);
}

async function testCreateTooManyOptions() {
  const tooMany = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-03-${10 + i}T18:00:00.000Z`,
    label: `Option ${i + 1}`,
  }));
  await expect(
    controller.create(mockReq as AuthenticatedRequest, {
      ...validBody,
      pollOptions: tooMany,
    }),
  ).rejects.toThrow(BadRequestException);
}

async function testCreateInvalidPollMode() {
  await expect(
    controller.create(mockReq as AuthenticatedRequest, {
      ...validBody,
      pollMode: 'invalid_mode',
    }),
  ).rejects.toThrow(BadRequestException);
}

async function testCreateReThrowsErrors() {
  (service.create as jest.Mock).mockRejectedValue(
    new Error('Unexpected error'),
  );
  await expect(
    controller.create(mockReq as AuthenticatedRequest, validBody),
  ).rejects.toThrow('Unexpected error');
}

async function testListPlans() {
  const result = await controller.listPlans();
  expect(result).toEqual([mockPlan]);
  expect(service.findAll).toHaveBeenCalled();
}

async function testListPlansEmpty() {
  (service.findAll as jest.Mock).mockResolvedValue([]);
  const result = await controller.listPlans();
  expect(result).toEqual([]);
}

async function testFindOneValid() {
  const result = await controller.findOne(PLAN_ID);
  expect(result).toEqual(mockPlan);
  expect(service.findOne).toHaveBeenCalledWith(PLAN_ID);
}

async function testFindOneNotFound() {
  (service.findOne as jest.Mock).mockRejectedValue(
    new NotFoundException(`Event plan ${PLAN_ID} not found`),
  );
  await expect(controller.findOne(PLAN_ID)).rejects.toThrow(NotFoundException);
}

async function testCancelPlan() {
  const result = await controller.cancel(
    PLAN_ID,
    mockReq as AuthenticatedRequest,
  );
  expect(result.status).toBe('cancelled');
  expect(service.cancel).toHaveBeenCalledWith(PLAN_ID, CREATOR_ID, 'member');
}

async function testCancelNotFound() {
  (service.cancel as jest.Mock).mockRejectedValue(
    new NotFoundException('Not found'),
  );
  await expect(
    controller.cancel(PLAN_ID, mockReq as AuthenticatedRequest),
  ).rejects.toThrow(NotFoundException);
}

beforeEach(() => setupEach());

describe('EventPlansController — getTimeSuggestions', () => {
  it('should call service with parsed params', () =>
    testTimeSuggestionsWithParams());
  it('should pass undefined when params absent', () =>
    testTimeSuggestionsUndefinedParams());
  it('should return time suggestions', () =>
    testTimeSuggestionsReturnsResult());
  it('should not require authentication', () => testTimeSuggestionsNoAuth());
});

describe('EventPlansController — create', () => {
  it('should create plan with valid data', () => testCreateWithValidData());
  it('should pass user id from request', () => testCreatePassesUserId());
  it('should throw for empty title', () => testCreateEmptyTitle());
  it('should throw for fewer than 2 pollOptions', () =>
    testCreateTooFewOptions());
  it('should throw for more than 9 pollOptions', () =>
    testCreateTooManyOptions());
  it('should throw for invalid pollMode', () => testCreateInvalidPollMode());
  it('should re-throw non-Zod errors', () => testCreateReThrowsErrors());
});

describe('EventPlansController — listPlans', () => {
  it('should return list of all plans', () => testListPlans());
  it('should return empty array when no plans', () => testListPlansEmpty());
});

describe('EventPlansController — findOne', () => {
  it('should return plan for valid UUID', () => testFindOneValid());
  it('should propagate NotFoundException', () => testFindOneNotFound());
});

describe('EventPlansController — cancel', () => {
  it('should cancel for authenticated user', () => testCancelPlan());
  it('should propagate NotFoundException', () => testCancelNotFound());
});
