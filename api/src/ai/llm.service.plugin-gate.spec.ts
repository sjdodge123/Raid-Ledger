/**
 * ROK-2368 guard (fix: ROK-2353). LlmService is the single choke point
 * every AI consumer goes through, so an inactive `ai` plugin must refuse
 * there: no provider is resolved and no provider method is dialled. The
 * consumer cases below prove each caller inherits that refusal without a
 * throw into its cron / queue loop.
 */
import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { LlmService } from './llm.service';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import type { LlmProvider } from './llm-provider.interface';
import {
  llmClassify,
  summarizeWithLlm,
} from '../discord-bot/ai-chat/helpers/llm-helpers';
import { runGenerateSuggestions } from '../discovery-categories/pipelines/generate-suggestions';
import { AiSuggestionsPreGenProcessor } from '../lineups/ai-suggestions/pre-gen.processor';
import type { AiSuggestionsPreGenJobData } from '../lineups/ai-suggestions/pre-gen.queue';
import type { SettingsService } from '../settings/settings.service';
import type { GameTasteService } from '../game-taste/game-taste.service';
import type { AiQuotaCooldownService } from '../lineups/ai-suggestions/quota-cooldown.service';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

function createProvider(): jest.Mocked<LlmProvider> {
  return {
    key: 'claude',
    displayName: 'Claude',
    requiresApiKey: true,
    selfHosted: false,
    defaultModel: 'claude-model',
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest.fn().mockResolvedValue([]),
    chat: jest.fn().mockResolvedValue({ content: 'paid', latencyMs: 1 }),
    generate: jest.fn().mockResolvedValue({ content: 'paid', latencyMs: 1 }),
  };
}

describe('LlmService refuses while the AI plugin is inactive (ROK-2368)', () => {
  let service: LlmService;
  let provider: jest.Mocked<LlmProvider>;
  let registry: { resolveActive: jest.Mock };
  let plugins: { isActive: jest.Mock };

  beforeEach(async () => {
    provider = createProvider();
    registry = {
      resolveActive: jest
        .fn()
        .mockResolvedValue({ provider, source: 'setting' }),
    };
    plugins = { isActive: jest.fn().mockReturnValue(false) };
    const module = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: LlmProviderRegistry, useValue: registry },
        {
          provide: AiRequestLogService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: PluginRegistryService, useValue: plugins },
      ],
    }).compile();
    service = module.get(LlmService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  function expectNoProviderCall(): void {
    expect(provider.chat).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.isAvailable).not.toHaveBeenCalled();
    expect(provider.listModels).not.toHaveBeenCalled();
  }

  describe('LlmService itself', () => {
    it('chat rejects with the no-provider NotFoundException', async () => {
      await expect(
        service.chat(
          { messages: [{ role: 'user', content: 'hi' }] },
          { feature: 't' },
        ),
      ).rejects.toThrow(NotFoundException);
      expectNoProviderCall();
    });

    it('generate rejects with the no-provider NotFoundException', async () => {
      await expect(
        service.generate({ prompt: 'hi' }, { feature: 't' }),
      ).rejects.toThrow(NotFoundException);
      expectNoProviderCall();
    });

    it('listModels rejects without asking the provider', async () => {
      await expect(service.listModels()).rejects.toThrow(NotFoundException);
      expectNoProviderCall();
    });

    it('isAvailable is false and never probes the provider', async () => {
      expect(await service.isAvailable()).toBe(false);
      expectNoProviderCall();
    });

    it('reports no provider key or default model', async () => {
      expect(await service.getActiveProviderKey()).toBeNull();
      expect(await service.getActiveDefaultModel()).toBeNull();
      expect(registry.resolveActive).not.toHaveBeenCalled();
    });

    it('asks the plugin registry about the `ai` plugin', async () => {
      await service.isAvailable();
      expect(plugins.isActive).toHaveBeenCalledWith('ai');
    });

    it('still calls the provider once the plugin is active again', async () => {
      plugins.isActive.mockReturnValue(true);
      const res = await service.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        { feature: 't' },
      );
      expect(res.content).toBe('paid');
      expect(provider.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe('consumers inherit the refusal', () => {
    it('Discord AI chat summary falls back to raw data, no provider call', async () => {
      const out = await summarizeWithLlm(service, new Logger('t'), 'raw data');
      expect(out).toContain('raw data');
      expectNoProviderCall();
    });

    it('Discord AI chat classifier returns null, no provider call', async () => {
      expect(await llmClassify(service, 'when is raid')).toBeNull();
      expectNoProviderCall();
    });

    it('weekly discovery-categories generation inserts nothing, no provider call', async () => {
      const settingsService = {
        get: jest.fn().mockResolvedValue('true'),
      } as unknown as SettingsService;
      const db = createDrizzleMock();
      const inserted = await runGenerateSuggestions(
        db as unknown as Parameters<typeof runGenerateSuggestions>[0],
        {
          llmService: service,
          settingsService,
        },
      );
      expect(inserted).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
      expectNoProviderCall();
    });

    it('lineup AI suggestions pre-gen job skips without touching the DB', async () => {
      const db = createDrizzleMock();
      const settings = { get: jest.fn().mockResolvedValue('true') };
      const cooldown = { isActive: jest.fn().mockResolvedValue(false) };
      const processor = new AiSuggestionsPreGenProcessor(
        db as unknown as ConstructorParameters<
          typeof AiSuggestionsPreGenProcessor
        >[0],
        settings as unknown as SettingsService,
        service,
        {} as GameTasteService,
        cooldown as unknown as AiQuotaCooldownService,
      );
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const job = {
        data: { lineupId: 7, reason: 'mutation' },
      } as unknown as Job<AiSuggestionsPreGenJobData>;

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(db.select).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('outcome=skipped_inactive'),
      );
      expectNoProviderCall();
    });
  });
});
