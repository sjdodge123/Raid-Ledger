/**
 * ROK-2354 — the weekly discovery-categories cron is an AI-plugin behaviour:
 * while the `ai` plugin is off it does no work (no tracked run, no LLM call,
 * no generate/expire writes). With the plugin on the cron is unchanged.
 */
import { Test } from '@nestjs/testing';
import { DiscoveryCategoriesService } from './discovery-categories.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { LlmService } from '../ai/llm.service';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

describe('DiscoveryCategoriesService.weeklyGenerateCron — AI plugin gate (ROK-2354)', () => {
  let service: DiscoveryCategoriesService;
  let plugins: { isActive: jest.Mock };
  let cron: { executeWithTracking: jest.Mock };
  let weekly: jest.SpyInstance;

  beforeEach(async () => {
    plugins = { isActive: jest.fn().mockReturnValue(true) };
    cron = {
      executeWithTracking: jest.fn(
        async (_name: string, fn: () => Promise<void>) => {
          await fn();
        },
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        DiscoveryCategoriesService,
        { provide: DrizzleAsyncProvider, useValue: {} },
        { provide: CronJobService, useValue: cron },
        { provide: LlmService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: PluginRegistryService, useValue: plugins },
      ],
    }).compile();
    service = module.get(DiscoveryCategoriesService);
    weekly = jest
      .spyOn(service, 'weeklyGenerate')
      .mockResolvedValue({ inserted: 0, expired: 0 });
  });

  it('does no work while the AI plugin is off', async () => {
    plugins.isActive.mockReturnValue(false);
    await service.weeklyGenerateCron();
    expect(plugins.isActive).toHaveBeenCalledWith('ai');
    expect(cron.executeWithTracking).not.toHaveBeenCalled();
    expect(weekly).not.toHaveBeenCalled();
  });

  it('runs the tracked weekly pass while the AI plugin is on', async () => {
    await service.weeklyGenerateCron();
    expect(cron.executeWithTracking).toHaveBeenCalledWith(
      'DiscoveryCategoriesService_weeklyGenerate',
      expect.any(Function),
    );
    expect(weekly).toHaveBeenCalledTimes(1);
  });
});
