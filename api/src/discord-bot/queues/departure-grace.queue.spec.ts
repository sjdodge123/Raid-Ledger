import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_QUEUE,
  DEPARTURE_GRACE_DELAY_MS,
} from './departure-grace.queue';

let service: DepartureGraceQueueService;
let mockQueue: {
  add: jest.Mock;
  getJob: jest.Mock;
};

beforeEach(async () => {
  mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DepartureGraceQueueService,
      { provide: getQueueToken(DEPARTURE_GRACE_QUEUE), useValue: mockQueue },
    ],
  }).compile();

  service = module.get(DepartureGraceQueueService);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('DEPARTURE_GRACE_DELAY_MS constant', () => {
  it('is 5 minutes in milliseconds', () => {
    expect(DEPARTURE_GRACE_DELAY_MS).toBe(5 * 60 * 1000);
  });
});

describe('DepartureGraceQueueService — enqueue: job creation', () => {
  const jobData = { eventId: 10, discordUserId: 'user-111', signupId: 5 };

  it('adds a delayed job with the correct job name and options', async () => {
    await service.enqueue(jobData, 300_000);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'departure-expire',
      jobData,
      expect.objectContaining({
        jobId: `depart-${jobData.eventId}-${jobData.discordUserId}`,
        delay: 300_000,
        attempts: 3,
        removeOnComplete: true,
      }),
    );
  });

  it('uses a unique job ID keyed to eventId + discordUserId', async () => {
    const dataA = { eventId: 1, discordUserId: 'user-A', signupId: 1 };
    const dataB = { eventId: 1, discordUserId: 'user-B', signupId: 2 };
    const dataC = { eventId: 2, discordUserId: 'user-A', signupId: 3 };

    await service.enqueue(dataA, 300_000);
    await service.enqueue(dataB, 300_000);
    await service.enqueue(dataC, 300_000);

    const calls = mockQueue.add.mock.calls;
    const jobIds = calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(new Set(jobIds).size).toBe(3);
    expect(jobIds[0]).toBe('depart-1-user-A');
    expect(jobIds[1]).toBe('depart-1-user-B');
    expect(jobIds[2]).toBe('depart-2-user-A');
  });

  it('propagates queue errors to the caller', async () => {
    mockQueue.add.mockRejectedValue(new Error('Redis connection lost'));

    await expect(service.enqueue(jobData, 300_000)).rejects.toThrow(
      'Redis connection lost',
    );
  });

  it('includes job data payload verbatim', async () => {
    const specificData = {
      eventId: 99,
      discordUserId: 'u-999',
      signupId: 42,
    };
    await service.enqueue(specificData, 300_000);

    expect(mockQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      specificData,
      expect.any(Object),
    );
  });
});

describe('DepartureGraceQueueService — enqueue: existing job handling', () => {
  const jobData = { eventId: 10, discordUserId: 'user-111', signupId: 5 };

  it('removes an existing delayed job before adding a new one (timer reset)', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(jobData, 300_000);

    expect(existingJob.remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('removes an existing waiting job before adding a new one', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(jobData, 300_000);

    expect(existingJob.remove).toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('does NOT remove an existing active job before adding a new one', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(jobData, 300_000);

    expect(existingJob.remove).not.toHaveBeenCalled();
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('does NOT remove a completed job before adding a new one', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('completed'),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(jobData, 300_000);

    expect(existingJob.remove).not.toHaveBeenCalled();
  });
});

describe('DepartureGraceQueueService — cancel', () => {
  it('removes a delayed job for the given user+event', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.cancel(10, 'user-111');

    expect(mockQueue.getJob).toHaveBeenCalledWith('depart-10-user-111');
    expect(existingJob.remove).toHaveBeenCalled();
  });

  it('removes a waiting job for the given user+event', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.cancel(10, 'user-111');

    expect(existingJob.remove).toHaveBeenCalled();
  });

  it('does nothing when no job exists for user+event', async () => {
    mockQueue.getJob.mockResolvedValue(null);

    await expect(service.cancel(10, 'user-111')).resolves.not.toThrow();
  });

  it('does not remove an active job', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.cancel(10, 'user-111');

    expect(existingJob.remove).not.toHaveBeenCalled();
  });

  it('does not remove a completed job', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('completed'),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.cancel(10, 'user-111');

    expect(existingJob.remove).not.toHaveBeenCalled();
  });

  it('handles queue errors gracefully without throwing', async () => {
    mockQueue.getJob.mockRejectedValue(new Error('Redis down'));

    await expect(service.cancel(10, 'user-111')).resolves.not.toThrow();
  });

  it('uses the correct job ID format for lookup', async () => {
    mockQueue.getJob.mockResolvedValue(null);

    await service.cancel(7, 'discord-abc');

    expect(mockQueue.getJob).toHaveBeenCalledWith('depart-7-discord-abc');
  });
});
