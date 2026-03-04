import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmbedSyncQueueService, EMBED_SYNC_QUEUE } from './embed-sync.queue';

describe('EmbedSyncQueueService', () => {
  let service: EmbedSyncQueueService;
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
        EmbedSyncQueueService,
        { provide: getQueueToken(EMBED_SYNC_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(EmbedSyncQueueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueue', () => {
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

    it('skips enqueue when an active job exists for the same event', async () => {
      const existingJob = {
        getState: jest.fn().mockResolvedValue('active'),
        updateData: jest.fn(),
        changeDelay: jest.fn(),
      };
      mockQueue.getJob.mockResolvedValue(existingJob);

      await service.enqueue(42, 'signup_created');

      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(existingJob.updateData).not.toHaveBeenCalled();
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

      await expect(
        service.enqueue(42, 'signup_created'),
      ).resolves.not.toThrow();
    });
  });
});
