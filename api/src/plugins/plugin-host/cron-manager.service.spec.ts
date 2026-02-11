import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CronManagerService } from './cron-manager.service';
import { PluginRegistryService } from './plugin-registry.service';
import type { CronRegistrar } from './extension-points';

describe('CronManagerService', () => {
  let service: CronManagerService;
  const createdJobs: CronJob[] = [];
  let mockSchedulerRegistry: {
    addCronJob: jest.Mock;
    deleteCronJob: jest.Mock;
    getCronJobs: jest.Mock;
  };
  let mockPluginRegistry: {
    getAdapter: jest.Mock;
  };

  beforeEach(async () => {
    mockSchedulerRegistry = {
      addCronJob: jest.fn().mockImplementation((_name: string, job: CronJob) => {
        createdJobs.push(job);
      }),
      deleteCronJob: jest.fn(),
      getCronJobs: jest.fn().mockReturnValue(new Map()),
    };

    mockPluginRegistry = {
      getAdapter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronManagerService,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: PluginRegistryService, useValue: mockPluginRegistry },
      ],
    }).compile();

    service = module.get<CronManagerService>(CronManagerService);
  });

  afterEach(() => {
    for (const job of createdJobs) {
      job.stop();
    }
    createdJobs.length = 0;
  });

  describe('handlePluginActivated()', () => {
    it('should register cron jobs from CronRegistrar adapter', () => {
      const handler = jest.fn();
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          { name: 'sync', cronExpression: '0 */6 * * *', handler },
        ],
      };

      mockPluginRegistry.getAdapter.mockReturnValue(adapter);

      service.handlePluginActivated({ slug: 'wow-plugin' });

      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
      const [jobName, cronJob] =
        mockSchedulerRegistry.addCronJob.mock.calls[0];
      expect(jobName).toBe('wow-plugin:sync');
      expect(cronJob).toBeInstanceOf(CronJob);
    });

    it('should do nothing when plugin has no CronRegistrar adapter', () => {
      mockPluginRegistry.getAdapter.mockReturnValue(undefined);

      service.handlePluginActivated({ slug: 'no-cron-plugin' });

      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });

    it('should register multiple cron jobs', () => {
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          { name: 'sync', cronExpression: '0 */6 * * *', handler: jest.fn() },
          {
            name: 'cleanup',
            cronExpression: '0 0 * * *',
            handler: jest.fn(),
          },
        ],
      };

      mockPluginRegistry.getAdapter.mockReturnValue(adapter);

      service.handlePluginActivated({ slug: 'multi-cron' });

      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(2);
      expect(mockSchedulerRegistry.addCronJob.mock.calls[0][0]).toBe(
        'multi-cron:sync',
      );
      expect(mockSchedulerRegistry.addCronJob.mock.calls[1][0]).toBe(
        'multi-cron:cleanup',
      );
    });

    it('should not throw when cron registration fails', () => {
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          {
            name: 'bad',
            cronExpression: 'invalid-cron',
            handler: jest.fn(),
          },
        ],
      };

      mockPluginRegistry.getAdapter.mockReturnValue(adapter);

      expect(() =>
        service.handlePluginActivated({ slug: 'bad-plugin' }),
      ).not.toThrow();
    });
  });

  describe('handlePluginDeactivated()', () => {
    it('should remove cron jobs with matching plugin prefix', () => {
      const jobs = new Map([
        ['wow-plugin:sync', { stop: jest.fn() }],
        ['wow-plugin:cleanup', { stop: jest.fn() }],
        ['other-plugin:task', { stop: jest.fn() }],
      ]);
      mockSchedulerRegistry.getCronJobs.mockReturnValue(jobs);

      service.handlePluginDeactivated({ slug: 'wow-plugin' });

      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledTimes(2);
      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        'wow-plugin:sync',
      );
      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        'wow-plugin:cleanup',
      );
    });

    it('should not remove jobs for other plugins', () => {
      const jobs = new Map([['other-plugin:task', { stop: jest.fn() }]]);
      mockSchedulerRegistry.getCronJobs.mockReturnValue(jobs);

      service.handlePluginDeactivated({ slug: 'wow-plugin' });

      expect(mockSchedulerRegistry.deleteCronJob).not.toHaveBeenCalled();
    });

    it('should handle empty job list gracefully', () => {
      mockSchedulerRegistry.getCronJobs.mockReturnValue(new Map());

      expect(() =>
        service.handlePluginDeactivated({ slug: 'wow-plugin' }),
      ).not.toThrow();
    });
  });
});
