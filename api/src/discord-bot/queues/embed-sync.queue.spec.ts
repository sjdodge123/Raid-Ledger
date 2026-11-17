import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmbedSyncQueueService, EMBED_SYNC_QUEUE } from './embed-sync.queue';

let service: EmbedSyncQueueService;
let mockQueue: {
  add: jest.Mock;
  getJob: jest.Mock;
  remove: jest.Mock;
};

beforeEach(async () => {
  mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(1),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EmbedSyncQueueService,
      { provide: getQueueToken(EMBED_SYNC_QUEUE), useValue: mockQueue },
    ],
  }).compile();

  service = module.get(EmbedSyncQueueService);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('EmbedSyncQueueService — enqueue: new jobs', () => {
  it('adds a delayed job when no existing job exists', async () => {
    await service.enqueue(42, 'signup_created');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-embed',
      { eventId: 42, reason: 'signup_created' },
      expect.objectContaining({
        jobId: 'embed-sync-42',
        delay: 2_000,
        attempts: 3,
        removeOnComplete: true,
      }),
    );
  });

  it('adds a new job when existing job is completed (stale)', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('completed'),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(42, 'signup_created');

    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('adds a new job when existing job is failed (stale)', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('failed'),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(42, 'signup_created');

    expect(mockQueue.add).toHaveBeenCalled();
  });

  it('uses deterministic job ID based on eventId', async () => {
    await service.enqueue(1, 'reason_a');
    await service.enqueue(2, 'reason_b');

    const jobIds = mockQueue.add.mock.calls.map(
      (c: [string, unknown, { jobId: string }]) => c[2].jobId,
    );
    expect(jobIds).toEqual(['embed-sync-1', 'embed-sync-2']);
  });

  it('handles queue errors gracefully without throwing', async () => {
    mockQueue.add.mockRejectedValue(new Error('Redis connection lost'));

    await expect(service.enqueue(42, 'signup_created')).resolves.not.toThrow();
  });
});

describe('EmbedSyncQueueService — enqueue: coalescing and skipping', () => {
  it('coalesces a delayed job by resetting delay instead of remove+re-add', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('delayed'),
      updateData: jest.fn().mockResolvedValue(undefined),
      changeDelay: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(42, 'signup_updated');

    expect(existingJob.updateData).toHaveBeenCalledWith({
      eventId: 42,
      reason: 'signup_updated',
    });
    expect(existingJob.changeDelay).toHaveBeenCalledWith(2_000);
    expect(existingJob.remove).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('skips enqueue when a waiting job exists for the same event', async () => {
    const existingJob = {
      getState: jest.fn().mockResolvedValue('waiting'),
      updateData: jest.fn(),
      changeDelay: jest.fn(),
    };
    mockQueue.getJob.mockResolvedValue(existingJob);

    await service.enqueue(42, 'signup_deleted');

    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(existingJob.updateData).not.toHaveBeenCalled();
  });
});

/** A mocked BullMQ job in a fixed state. */
function jobIn(state: string) {
  return {
    getState: jest.fn().mockResolvedValue(state),
    updateData: jest.fn().mockResolvedValue(undefined),
    changeDelay: jest.fn().mockResolvedValue(undefined),
  };
}

/** Route `queue.getJob(id)` to a per-id job; unknown ids resolve to null. */
function routeJobs(jobs: Record<string, unknown>): void {
  mockQueue.getJob.mockImplementation((id: string) =>
    Promise.resolve(jobs[id] ?? null),
  );
}

describe('EmbedSyncQueueService — enqueue while a sync is active (ROK-2227)', () => {
  it('adds one delayed follow-up job when the main job is active', async () => {
    routeJobs({ 'embed-sync-42': jobIn('active') });

    await service.enqueue(42, 'roster_updated');

    // The active job may already have read the DB; without a follow-up this
    // write never reaches the embed (event 316 stayed at DPS 1/3).
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-embed',
      { eventId: 42, reason: 'roster_updated' },
      expect.objectContaining({
        jobId: 'embed-sync-42-followup',
        delay: 2_000,
        attempts: 3,
        removeOnComplete: true,
      }),
    );
  });

  it('coalesces a second enqueue into the pending follow-up instead of adding another', async () => {
    const followUp = jobIn('delayed');
    routeJobs({
      'embed-sync-42': jobIn('active'),
      'embed-sync-42-followup': followUp,
    });

    await service.enqueue(42, 'signup_updated');

    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(followUp.updateData).toHaveBeenCalledWith({
      eventId: 42,
      reason: 'signup_updated',
    });
    expect(followUp.changeDelay).toHaveBeenCalledWith(2_000);
  });

  it('N enqueues during one active job produce exactly one follow-up', async () => {
    const jobs: Record<string, unknown> = { 'embed-sync-42': jobIn('active') };
    routeJobs(jobs);
    mockQueue.add.mockImplementation(
      (_name: string, _data: unknown, opts: { jobId: string }) => {
        jobs[opts.jobId] = jobIn('delayed');
        return Promise.resolve(undefined);
      },
    );

    await service.enqueue(42, 'a');
    await service.enqueue(42, 'b');
    await service.enqueue(42, 'c');

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
  });

  it('skips when the follow-up is already waiting — it has not read the DB yet', async () => {
    const followUp = jobIn('waiting');
    routeJobs({
      'embed-sync-42': jobIn('active'),
      'embed-sync-42-followup': followUp,
    });

    await service.enqueue(42, 'signup_deleted');

    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(followUp.updateData).not.toHaveBeenCalled();
  });

  it('replaces a finished follow-up left over from an earlier active window', async () => {
    routeJobs({
      'embed-sync-42': jobIn('active'),
      'embed-sync-42-followup': jobIn('completed'),
    });

    await service.enqueue(42, 'roster_updated');

    expect(mockQueue.remove).toHaveBeenCalledWith('embed-sync-42-followup');
    expect(mockQueue.add).toHaveBeenCalledWith(
      'sync-embed',
      expect.anything(),
      expect.objectContaining({ jobId: 'embed-sync-42-followup' }),
    );
  });

  it('does not add a follow-up when the main job is only waiting', async () => {
    routeJobs({ 'embed-sync-42': jobIn('waiting') });

    await service.enqueue(42, 'signup_created');

    expect(mockQueue.getJob).not.toHaveBeenCalledWith('embed-sync-42-followup');
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
