import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(): LlmProvider {
  return {
    key: 'ollama',
    displayName: 'Ollama',
    requiresApiKey: false,
    selfHosted: true,
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest
      .fn()
      .mockResolvedValue([
        { id: 'model-1', name: 'Model 1', provider: 'ollama' },
      ]),
    chat: jest.fn().mockResolvedValue({
      content: 'Hello!',
      usage: { promptTokens: 10, completionTokens: 5 },
      latencyMs: 100,
    }),
    generate: jest.fn().mockResolvedValue({
      content: 'Generated text',
      usage: { promptTokens: 15, completionTokens: 10 },
      latencyMs: 200,
    }),
  };
}

describe('LlmService', () => {
  let service: LlmService;
  let mockRegistry: {
    resolveActive: jest.Mock;
    list: jest.Mock;
  };
  let mockLogService: { log: jest.Mock };
  let mockProvider: LlmProvider;

  beforeEach(async () => {
    mockProvider = createMockProvider();
    mockRegistry = {
      resolveActive: jest.fn().mockResolvedValue(mockProvider),
      list: jest.fn().mockReturnValue([mockProvider]),
    };
    mockLogService = { log: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: LlmProviderRegistry, useValue: mockRegistry },
        { provide: AiRequestLogService, useValue: mockLogService },
      ],
    }).compile();
    service = module.get(LlmService);
  });

  describe('chat', () => {
    it('delegates to the active provider and returns response', async () => {
      const result = await service.chat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { feature: 'test' },
      );
      expect(result.content).toBe('Hello!');
      expect(result).toHaveProperty('latencyMs');
    });

    it('logs the request to the log service', async () => {
      await service.chat(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { feature: 'test', userId: 1 },
      );
      expect(mockLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'test',
          userId: 1,
          success: true,
        }),
      );
    });

    it('throws NotFoundException when no provider available', async () => {
      mockRegistry.resolveActive.mockResolvedValue(undefined);
      await expect(
        service.chat(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { feature: 'test' },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generate', () => {
    it('delegates to the active provider', async () => {
      const result = await service.generate(
        { prompt: 'Write something' },
        { feature: 'test' },
      );
      expect(result.content).toBe('Generated text');
    });

    it('logs the request to the log service', async () => {
      await service.generate(
        { prompt: 'Write something' },
        { feature: 'categories', userId: 2 },
      );
      expect(mockLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'categories',
          userId: 2,
          success: true,
        }),
      );
    });
  });

  describe('isAvailable', () => {
    it('returns true when provider is available', async () => {
      const result = await service.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when no provider is configured', async () => {
      mockRegistry.resolveActive.mockResolvedValue(undefined);
      const result = await service.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('listModels', () => {
    it('returns models from the active provider', async () => {
      const models = await service.listModels();
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({ id: 'model-1' });
    });
  });
});
