import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CronManagerService } from './cron-manager.service';
import { PluginRegistryService } from './plugin-registry.service';
import type { CronRegistrar } from './extension-points';

describe('CronManagerService', () => {
  let service: CronManagerService;
  const createdJobs: CronJob[] = [];
  let registeredJobNames: Set<string>;
  let mockSchedulerRegistry: {
    addCronJob: jest.Mock;
    deleteCronJob: jest.Mock;
    getCronJobs: jest.Mock;
    getCronJob: jest.Mock;
  };
  let mockPluginRegistry: {
    getAdapter: jest.Mock;
    getAdaptersForExtensionPoint: jest.Mock;
  };

  beforeEach(async () => {
    registeredJobNames = new Set();
    mockSchedulerRegistry = {
      addCronJob: jest.fn().mockImplementation((name: string, job: CronJob) => {
        registeredJobNames.add(name);
        createdJobs.push(job);
      }),
      deleteCronJob: jest.fn().mockImplementation((name: string) => {
        registeredJobNames.delete(name);
      }),
      getCronJobs: jest.fn().mockReturnValue(new Map()),
      getCronJob: jest.fn().mockImplementation((name: string) => {
        if (registeredJobNames.has(name)) return {};
        throw new Error(`No Cron Job was found with the given name (${name})`);
      }),
    };

    mockPluginRegistry = {
      getAdapter: jest.fn(),
      getAdaptersForExtensionPoint: jest.fn().mockReturnValue(new Map()),
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
      void job.stop();
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
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'wow-plugin:sync',
        expect.any(CronJob),
      );
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
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'multi-cron:sync',
        expect.any(CronJob),
      );
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'multi-cron:cleanup',
        expect.any(CronJob),
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

  describe('onApplicationBootstrap()', () => {
    it('should register cron jobs for all active plugins at startup', () => {
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          { name: 'sync', cronExpression: '0 */6 * * *', handler: jest.fn() },
        ],
      };

      mockPluginRegistry.getAdaptersForExtensionPoint.mockReturnValue(
        new Map([['blizzard', adapter]]),
      );

      service.onApplicationBootstrap();

      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'blizzard:sync',
        expect.any(CronJob),
      );
    });

    it('should handle no active plugins gracefully', () => {
      mockPluginRegistry.getAdaptersForExtensionPoint.mockReturnValue(
        new Map(),
      );

      expect(() => service.onApplicationBootstrap()).not.toThrow();
      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled();
    });

    it('should skip jobs already in SchedulerRegistry (idempotent)', () => {
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          { name: 'sync', cronExpression: '0 */6 * * *', handler: jest.fn() },
        ],
      };

      mockPluginRegistry.getAdaptersForExtensionPoint.mockReturnValue(
        new Map([['blizzard', adapter]]),
      );
      mockPluginRegistry.getAdapter.mockReturnValue(adapter);

      // Bootstrap registers the job
      service.onApplicationBootstrap();
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);

      // ACTIVATED event fires — should skip because job is already registered
      service.handlePluginActivated({ slug: 'blizzard' });
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
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

    it('should allow re-registration after deactivation + re-activation', () => {
      const adapter: CronRegistrar = {
        getCronJobs: () => [
          { name: 'sync', cronExpression: '0 */6 * * *', handler: jest.fn() },
        ],
      };

      mockPluginRegistry.getAdaptersForExtensionPoint.mockReturnValue(
        new Map([['blizzard', adapter]]),
      );
      mockPluginRegistry.getAdapter.mockReturnValue(adapter);

      // Bootstrap registers the job
      service.onApplicationBootstrap();
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);

      // Deactivate removes it
      const jobs = new Map([['blizzard:sync', { stop: jest.fn() }]]);
      mockSchedulerRegistry.getCronJobs.mockReturnValue(jobs);
      service.handlePluginDeactivated({ slug: 'blizzard' });
      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        'blizzard:sync',
      );

      // Re-activate re-registers it
      service.handlePluginActivated({ slug: 'blizzard' });
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledTimes(2);
    });
  });
});
