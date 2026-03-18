import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  EventLifecycleQueueService,
  EVENT_LIFECYCLE_QUEUE,
} from './event-lifecycle.queue';
import type { EventPayload } from '../listeners/event.listener';

const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const futureEnd = new Date(futureDate.getTime() + 3 * 60 * 60 * 1000);

const mockPayload: EventPayload = {
  eventId: 42,
  event: {
    id: 42,
    title: 'Raid Night',
    startTime: futureDate.toISOString(),
    endTime: futureEnd.toISOString(),
    signupCount: 0,
    maxAttendees: 20,
    game: { name: 'WoW', coverUrl: null },
  },
  gameId: 101,
  creatorId: 1,
};

let service: EventLifecycleQueueService;
let mockQueue: {
  add: jest.Mock;
};

beforeEach(async () => {
  mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventLifecycleQueueService,
      { provide: getQueueToken(EVENT_LIFECYCLE_QUEUE), useValue: mockQueue },
    ],
  }).compile();

  service = module.get(EventLifecycleQueueService);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('EventLifecycleQueueService — enqueue', () => {
  it('adds a job with deterministic jobId based on eventId', async () => {
    await service.enqueue(42, mockPayload);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'event-created',
      { eventId: 42, payload: mockPayload },
      expect.objectContaining({
        jobId: 'event-created-42',
        attempts: 3,
        removeOnComplete: true,
      }),
    );
  });

  it('uses exponential backoff for retries', async () => {
    await service.enqueue(42, mockPayload);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'event-created',
      expect.anything(),
      expect.objectContaining({
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });

  it('uses different jobIds for different events', async () => {
    const payload2 = { ...mockPayload, eventId: 99 };
    await service.enqueue(42, mockPayload);
    await service.enqueue(99, payload2);

    const jobIds = mockQueue.add.mock.calls.map(
      (c: [string, unknown, { jobId: string }]) => c[2].jobId,
    );
    expect(jobIds).toEqual(['event-created-42', 'event-created-99']);
  });

  it('handles queue errors gracefully without throwing', async () => {
    mockQueue.add.mockRejectedValue(new Error('Redis connection lost'));

    await expect(service.enqueue(42, mockPayload)).resolves.not.toThrow();
  });
});
