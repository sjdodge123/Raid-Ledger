import { Test } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { DemoTestService } from './demo-test.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';

function createMockDb() {
  return {} as Record<string, jest.Mock>;
}

function createMockSettingsService(demoMode = true) {
  return { getDemoMode: jest.fn().mockResolvedValue(demoMode) };
}

function createMockModuleRef(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn().mockImplementation((token: unknown) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return overrides[name] ?? {};
    }),
  };
}

describe('DemoTestService — test utility endpoints', () => {
  let service: DemoTestService;
  let mockQueueHealth: { drainAll: jest.Mock; awaitDrained: jest.Mock };
  let mockModuleRef: ReturnType<typeof createMockModuleRef>;

  beforeEach(async () => {
    mockQueueHealth = {
      drainAll: jest.fn().mockResolvedValue(undefined),
      awaitDrained: jest.fn().mockResolvedValue(undefined),
    };

    const mockVoiceAttendance = {
      flushToDb: jest.fn().mockResolvedValue(undefined),
    };

    mockModuleRef = createMockModuleRef({
      VoiceAttendanceService: mockVoiceAttendance,
      QueueHealthService: mockQueueHealth,
    });

    process.env.DEMO_MODE = 'true';

    const module = await Test.createTestingModule({
      providers: [
        DemoTestService,
        { provide: DrizzleAsyncProvider, useValue: createMockDb() },
        {
          provide: SettingsService,
          useValue: createMockSettingsService(true),
        },
        { provide: ModuleRef, useValue: mockModuleRef },
      ],
    }).compile();

    service = module.get(DemoTestService);
  });

  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('flushVoiceSessionsForTest calls VoiceAttendanceService.flushToDb', async () => {
    const result = await service.flushVoiceSessionsForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockModuleRef.get).toHaveBeenCalled();
  });

  it('flushEmbedQueueForTest calls QueueHealthService.drainAll', async () => {
    const result = await service.flushEmbedQueueForTest();
    expect(result).toMatchObject({ success: true });
  });

  it('awaitProcessingForTest calls QueueHealthService.awaitDrained', async () => {
    await service.awaitProcessingForTest(5000);
    expect(mockQueueHealth.awaitDrained).toHaveBeenCalledWith(5000);
  });

  it('rejects when DEMO_MODE is disabled', async () => {
    process.env.DEMO_MODE = 'false';
    await expect(service.flushVoiceSessionsForTest()).rejects.toThrow(
      ForbiddenException,
    );
  });

  describe('pauseReconciliationForTest (ROK-969)', () => {
    it('pauses the reconciliation cron job via CronJobService', async () => {
      const mockCronJobService = {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: 7,
            name: 'ScheduledEventReconciliation_reconcileMissing',
            paused: false,
          },
        ]),
        pauseJob: jest.fn().mockResolvedValue(undefined),
      };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'CronJobService') return mockCronJobService;
        return {};
      });

      const result = await service.pauseReconciliationForTest();

      expect(result).toMatchObject({ success: true });
      expect(mockCronJobService.listJobs).toHaveBeenCalled();
      expect(mockCronJobService.pauseJob).toHaveBeenCalledWith(7);
    });

    it('skips pausing if the job is already paused', async () => {
      const mockCronJobService = {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: 7,
            name: 'ScheduledEventReconciliation_reconcileMissing',
            paused: true,
          },
        ]),
        pauseJob: jest.fn(),
      };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'CronJobService') return mockCronJobService;
        return {};
      });

      const result = await service.pauseReconciliationForTest();

      expect(result).toMatchObject({ success: true });
      expect(mockCronJobService.pauseJob).not.toHaveBeenCalled();
    });

    it('succeeds gracefully when the job is not found', async () => {
      const mockCronJobService = {
        listJobs: jest.fn().mockResolvedValue([]),
        pauseJob: jest.fn(),
      };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'CronJobService') return mockCronJobService;
        return {};
      });

      const result = await service.pauseReconciliationForTest();

      expect(result).toMatchObject({ success: true });
      expect(mockCronJobService.pauseJob).not.toHaveBeenCalled();
    });
  });

  describe('enableScheduledEventsForTest (ROK-969)', () => {
    it('calls setScheduledEventsEnabled(true) on ScheduledEventService', async () => {
      const mockSeSvc = { setScheduledEventsEnabled: jest.fn() };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'ScheduledEventService') return mockSeSvc;
        return {};
      });

      const result = await service.enableScheduledEventsForTest();

      expect(result).toMatchObject({ success: true });
      expect(mockSeSvc.setScheduledEventsEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe('disableScheduledEventsForTest (ROK-969)', () => {
    it('calls setScheduledEventsEnabled(false) on ScheduledEventService', async () => {
      const mockSeSvc = { setScheduledEventsEnabled: jest.fn() };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'ScheduledEventService') return mockSeSvc;
        return {};
      });

      const result = await service.disableScheduledEventsForTest();

      expect(result).toMatchObject({ success: true });
      expect(mockSeSvc.setScheduledEventsEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('setEventTimesForTest (ROK-969)', () => {
    it('updates event duration in the DB', async () => {
      const mockWhere = jest.fn().mockResolvedValue(undefined);
      const mockSet = jest.fn().mockReturnValue({ where: mockWhere });
      const mockUpdate = jest.fn().mockReturnValue({ set: mockSet });
      const dbWithUpdate = service['db'] as unknown as Record<string, unknown>;
      dbWithUpdate.update = mockUpdate;

      const result = await service.setEventTimesForTest(
        1,
        '2026-04-01T00:00:00Z',
        '2026-04-01T02:00:00Z',
      );

      expect(result).toMatchObject({ success: true });
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('rejects when DEMO_MODE is disabled', async () => {
      process.env.DEMO_MODE = 'false';
      await expect(
        service.setEventTimesForTest(1, '2026-04-01T00:00:00Z', '2026-04-01T02:00:00Z'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cleanupScheduledEventsForTest', () => {
    it('deletes all scheduled events and returns counts', async () => {
      const mockSe1 = {
        id: '1',
        delete: jest.fn().mockResolvedValue(undefined),
      };
      const mockSe2 = {
        id: '2',
        delete: jest.fn().mockResolvedValue(undefined),
      };
      const mockGuild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(
            new Map([
              ['1', mockSe1],
              ['2', mockSe2],
            ]),
          ),
        },
      };
      const mockClientService = {
        getGuild: jest.fn().mockReturnValue(mockGuild),
      };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'DiscordBotClientService') return mockClientService;
        return {};
      });

      const result = await service.cleanupScheduledEventsForTest();
      expect(result).toMatchObject({
        success: true,
        deleted: 2,
        failed: 0,
        total: 2,
      });
      expect(mockSe1.delete).toHaveBeenCalled();
      expect(mockSe2.delete).toHaveBeenCalled();
    });

    it('counts failures without throwing', async () => {
      const mockSe1 = {
        id: '1',
        delete: jest.fn().mockRejectedValue(new Error('fail')),
      };
      const mockGuild = {
        scheduledEvents: {
          fetch: jest.fn().mockResolvedValue(new Map([['1', mockSe1]])),
        },
      };
      const mockClientService = {
        getGuild: jest.fn().mockReturnValue(mockGuild),
      };
      mockModuleRef.get.mockImplementation((token: unknown) => {
        const name = typeof token === 'function' ? token.name : String(token);
        if (name === 'DiscordBotClientService') return mockClientService;
        return {};
      });

      const result = await service.cleanupScheduledEventsForTest();
      expect(result).toMatchObject({
        success: true,
        deleted: 0,
        failed: 1,
        total: 1,
      });
    });
  });
});
