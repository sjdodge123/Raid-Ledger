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
});
