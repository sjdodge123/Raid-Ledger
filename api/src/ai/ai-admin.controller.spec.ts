import { Test } from '@nestjs/testing';
import { AiAdminController } from './ai-admin.controller';
import { LlmService } from './llm.service';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { Reflector } from '@nestjs/core';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(): LlmProvider {
  return {
    key: 'ollama',
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    selfHosted: true,
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest.fn().mockResolvedValue([]),
    chat: jest.fn(),
    generate: jest.fn(),
  };
}

describe('AiAdminController', () => {
  let controller: AiAdminController;
  let mockLlmService: { isAvailable: jest.Mock; listModels: jest.Mock };
  let mockRegistry: { resolveActive: jest.Mock };
  let mockLogService: { getUsageStats: jest.Mock };
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockLlmService = {
      isAvailable: jest.fn().mockResolvedValue(true),
      listModels: jest.fn().mockResolvedValue([]),
    };
    mockRegistry = {
      resolveActive: jest.fn().mockResolvedValue(createMockProvider()),
    };
    mockLogService = {
      getUsageStats: jest.fn().mockResolvedValue({
        totalRequests: 50,
        requestsToday: 10,
        avgLatencyMs: 100,
        errorRate: 0.02,
        byFeature: [],
      }),
    };
    mockSettings = { get: jest.fn().mockResolvedValue(null) };

    const module = await Test.createTestingModule({
      controllers: [AiAdminController],
      providers: [
        { provide: LlmService, useValue: mockLlmService },
        { provide: LlmProviderRegistry, useValue: mockRegistry },
        { provide: AiRequestLogService, useValue: mockLogService },
        { provide: SettingsService, useValue: mockSettings },
        { provide: PluginRegistryService, useValue: { isActive: jest.fn() } },
        { provide: Reflector, useValue: new Reflector() },
      ],
    }).compile();
    controller = module.get(AiAdminController);
  });

  describe('getStatus', () => {
    it('returns provider status information', async () => {
      const result = await controller.getStatus();
      expect(result).toMatchObject({
        provider: 'ollama',
        available: true,
        selfHosted: true,
      });
    });
  });

  describe('getModels', () => {
    it('returns list of available models', async () => {
      mockLlmService.listModels.mockResolvedValue([
        { id: 'llama3.2:3b', name: 'llama3.2:3b', provider: 'ollama' },
      ]);
      const result = await controller.getModels();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'llama3.2:3b' });
    });
  });

  describe('testConnection', () => {
    it('returns success when provider is available', async () => {
      const result = await controller.testConnection();
      expect(result).toMatchObject({
        success: true,
        message: expect.any(String),
      });
    });

    it('returns failure when provider is unavailable', async () => {
      mockLlmService.isAvailable.mockResolvedValue(false);
      const result = await controller.testConnection();
      expect(result.success).toBe(false);
    });
  });

  describe('getUsage', () => {
    it('returns usage statistics', async () => {
      const result = await controller.getUsage();
      expect(result).toMatchObject({
        totalRequests: expect.any(Number),
        requestsToday: expect.any(Number),
      });
    });
  });
});
