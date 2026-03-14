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

// — Adversarial tests —

describe('AiAdminController (adversarial)', () => {
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
    mockRegistry = { resolveActive: jest.fn().mockResolvedValue(undefined) };
    mockLogService = {
      getUsageStats: jest.fn().mockResolvedValue({
        totalRequests: 0,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0,
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

  describe('getStatus — no provider configured', () => {
    it('returns provider: "none" when no provider is registered', async () => {
      mockRegistry.resolveActive.mockResolvedValue(undefined);
      mockLlmService.isAvailable.mockResolvedValue(false);
      const result = await controller.getStatus();
      expect(result.provider).toBe('none');
      expect(result.providerName).toBe('Not configured');
      expect(result.available).toBe(false);
    });

    it('returns selfHosted: false when no provider', async () => {
      mockRegistry.resolveActive.mockResolvedValue(undefined);
      const result = await controller.getStatus();
      expect(result.selfHosted).toBe(false);
    });

    it('returns dockerStatus "unknown" when provider unavailable', async () => {
      mockLlmService.isAvailable.mockResolvedValue(false);
      const result = await controller.getStatus();
      expect(result.dockerStatus).toBe('unknown');
    });
  });

  describe('getStatus — provider available', () => {
    it('includes currentModel from settings', async () => {
      mockSettings.get.mockResolvedValue('phi3:mini');
      mockRegistry.resolveActive.mockResolvedValue({
        key: 'ollama',
        displayName: 'Ollama (Local)',
        selfHosted: true,
        requiresApiKey: false,
        isAvailable: jest.fn(),
        listModels: jest.fn(),
        chat: jest.fn(),
        generate: jest.fn(),
      });
      const result = await controller.getStatus();
      expect(result.currentModel).toBe('phi3:mini');
    });
  });

  describe('getModels — empty state', () => {
    it('returns empty array when no models available', async () => {
      mockLlmService.listModels.mockResolvedValue([]);
      const result = await controller.getModels();
      expect(result).toEqual([]);
    });

    it('maps model capabilities[0] to family field', async () => {
      mockLlmService.listModels.mockResolvedValue([
        {
          id: 'llama3.2:3b',
          name: 'llama3.2:3b',
          provider: 'ollama',
          capabilities: ['llama'],
        },
      ]);
      const result = await controller.getModels();
      expect(result[0].family).toBe('llama');
    });

    it('family is undefined when capabilities is absent', async () => {
      mockLlmService.listModels.mockResolvedValue([
        { id: 'custom', name: 'custom', provider: 'ollama' },
      ]);
      const result = await controller.getModels();
      expect(result[0].family).toBeUndefined();
    });
  });

  describe('testConnection — timing', () => {
    it('returns a numeric latencyMs', async () => {
      const result = await controller.testConnection();
      expect(typeof result.latencyMs).toBe('number');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('includes latency in the success message when available', async () => {
      mockLlmService.isAvailable.mockResolvedValue(true);
      const result = await controller.testConnection();
      expect(result.message).toContain('ms');
    });

    it('returns failure message when not available', async () => {
      mockLlmService.isAvailable.mockResolvedValue(false);
      const result = await controller.testConnection();
      expect(result.message).toContain('Failed');
    });
  });

  describe('getUsage — zero stats', () => {
    it('returns zero values gracefully', async () => {
      const result = await controller.getUsage();
      expect(result).toMatchObject({
        totalRequests: 0,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0,
        byFeature: [],
      });
    });
  });
});
