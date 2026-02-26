import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  AdHocGracePeriodQueueService,
  AD_HOC_GRACE_QUEUE,
} from './ad-hoc-grace-period.queue';

describe('AdHocGracePeriodQueueService', () => {
  let service: AdHocGracePeriodQueueService;
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
        AdHocGracePeriodQueueService,
        { provide: getQueueToken(AD_HOC_GRACE_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(AdHocGracePeriodQueueService);
  });

  describe('enqueue', () => {
    it('adds a delayed job to the queue', async () => {
      await service.enqueue(42, 300_000);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'grace-expire',
        { eventId: 42 },
        expect.objectContaining({
          jobId: 'grace-42',
          delay: 300_000,
          attempts: 3,
          removeOnComplete: true,
        }),
      );
    });

    it('removes existing delayed/waiting job before adding new one', async () => {
      const mockExistingJob = {
        getState: jest.fn().mockResolvedValue('delayed'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob.mockResolvedValue(mockExistingJob);

      await service.enqueue(42, 300_000);

      expect(mockExistingJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('does not remove existing job if it is already active/completed', async () => {
      const mockExistingJob = {
        getState: jest.fn().mockResolvedValue('active'),
        remove: jest.fn(),
      };
      mockQueue.getJob.mockResolvedValue(mockExistingJob);

      await service.enqueue(42, 300_000);

      expect(mockExistingJob.remove).not.toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalled();
    });

    it('propagates queue errors to caller', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));

      await expect(service.enqueue(42, 300_000)).rejects.toThrow('Redis down');
    });
  });

  describe('cancel', () => {
    it('removes delayed job for the event', async () => {
      const mockExistingJob = {
        getState: jest.fn().mockResolvedValue('delayed'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob.mockResolvedValue(mockExistingJob);

      await service.cancel(42);

      expect(mockQueue.getJob).toHaveBeenCalledWith('grace-42');
      expect(mockExistingJob.remove).toHaveBeenCalled();
    });

    it('removes waiting job for the event', async () => {
      const mockExistingJob = {
        getState: jest.fn().mockResolvedValue('waiting'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      mockQueue.getJob.mockResolvedValue(mockExistingJob);

      await service.cancel(42);

      expect(mockExistingJob.remove).toHaveBeenCalled();
    });

    it('does nothing when no job exists', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      await service.cancel(42);

      // No error
    });

    it('does not remove active/completed jobs', async () => {
      const mockExistingJob = {
        getState: jest.fn().mockResolvedValue('completed'),
        remove: jest.fn(),
      };
      mockQueue.getJob.mockResolvedValue(mockExistingJob);

      await service.cancel(42);

      expect(mockExistingJob.remove).not.toHaveBeenCalled();
    });

    it('handles queue errors gracefully', async () => {
      mockQueue.getJob.mockRejectedValue(new Error('Redis down'));

      await expect(service.cancel(42)).resolves.not.toThrow();
    });
  });
});
