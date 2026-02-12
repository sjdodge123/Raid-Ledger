/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { IgdbSyncProcessor } from './igdb-sync.processor';
import { IGDB_SYNC_QUEUE } from './igdb-sync.constants';
import { IgdbService } from './igdb.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { Job } from 'bullmq';

describe('IgdbSyncProcessor', () => {
  let processor: IgdbSyncProcessor;
  let mockIgdbService: { syncAllGames: jest.Mock };
  let mockQueue: { name: string; getJobCounts: jest.Mock };
  let mockQueueHealth: { register: jest.Mock; getHealthStatus: jest.Mock };

  beforeEach(async () => {
    mockIgdbService = {
      syncAllGames: jest
        .fn()
        .mockResolvedValue({ refreshed: 10, discovered: 50 }),
    };

    mockQueue = {
      name: IGDB_SYNC_QUEUE,
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      }),
    };

    mockQueueHealth = {
      register: jest.fn(),
      getHealthStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IgdbSyncProcessor,
        { provide: IgdbService, useValue: mockIgdbService },
        { provide: getQueueToken(IGDB_SYNC_QUEUE), useValue: mockQueue },
        { provide: QueueHealthService, useValue: mockQueueHealth },
      ],
    }).compile();

    processor = module.get<IgdbSyncProcessor>(IgdbSyncProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('should register queue with health service on init', () => {
    processor.onModuleInit();
    expect(mockQueueHealth.register).toHaveBeenCalledWith(mockQueue);
  });

  it('should call syncAllGames and update progress', async () => {
    const mockUpdateProgress = jest.fn().mockResolvedValue(undefined);
    const mockJob = {
      data: { trigger: 'scheduled' },
      updateProgress: mockUpdateProgress,
    } as unknown as Job;

    const result = await processor.process(mockJob);

    expect(mockUpdateProgress).toHaveBeenCalledWith(0);
    expect(mockIgdbService.syncAllGames).toHaveBeenCalled();
    expect(mockUpdateProgress).toHaveBeenCalledWith(100);
    expect(result).toEqual({ refreshed: 10, discovered: 50 });
  });

  it('should propagate errors from syncAllGames', async () => {
    mockIgdbService.syncAllGames.mockRejectedValueOnce(
      new Error('IGDB API down'),
    );

    const mockUpdateProgress = jest.fn().mockResolvedValue(undefined);
    const mockJob = {
      data: { trigger: 'manual' },
      updateProgress: mockUpdateProgress,
    } as unknown as Job;

    await expect(processor.process(mockJob)).rejects.toThrow('IGDB API down');
    expect(mockUpdateProgress).toHaveBeenCalledWith(0);
  });
});
