import { Test } from '@nestjs/testing';
import { AiAdminController } from './ai-admin.controller';
import { LlmService } from './llm.service';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { Reflector } from '@nestjs/core';
import type { LlmProvider } from './llm-provider.interface';
import { AI_DEFAULTS, CLOUD_DEFAULTS } from './llm.constants';

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

// --- ROK-1000: Test-chat timeout and diagnostic logging ---

describe('ROK-1000: testChat timeout and diagnostics', () => {
  let controller: AiAdminController;
  let mockLlmService: {
    isAvailable: jest.Mock;
    listModels: jest.Mock;
    chat: jest.Mock;
  };
  let mockRegistry: { resolveActive: jest.Mock };
  let mockLogService: { getUsageStats: jest.Mock };
  let mockSettings: { get: jest.Mock };

  beforeEach(async () => {
    mockLlmService = {
      isAvailable: jest.fn().mockResolvedValue(true),
      listModels: jest.fn().mockResolvedValue([]),
      chat: jest.fn().mockResolvedValue({
        content: 'Hello!',
        latencyMs: 150,
      }),
    };
    mockRegistry = {
      resolveActive: jest.fn().mockResolvedValue({
        key: 'ollama',
        displayName: 'Ollama (Local)',
        requiresApiKey: false,
        selfHosted: true,
        isAvailable: jest.fn().mockResolvedValue(true),
        listModels: jest.fn().mockResolvedValue([]),
        chat: jest.fn(),
        generate: jest.fn(),
      }),
    };
    mockLogService = {
      getUsageStats: jest.fn().mockResolvedValue({
        totalRequests: 0,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0,
        byFeature: [],
      }),
    };
    mockSettings = { get: jest.fn().mockResolvedValue('llama3.2:3b') };

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

  // --- AC6: Test-chat uses 120s timeout (ROK-1006: cold-start on CPU-only NAS) ---

  it('AC6: calls llmService.chat with maxTimeoutMs for cold-start tolerance', async () => {
    await controller.testChat();

    expect(mockLlmService.chat).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ timeoutMs: AI_DEFAULTS.maxTimeoutMs }),
    );
  });

  it('AC6: timeout is AI_DEFAULTS.maxTimeoutMs (120_000)', async () => {
    await controller.testChat();

    const context = mockLlmService.chat.mock.calls[0][1];
    expect(context.timeoutMs).toBe(AI_DEFAULTS.maxTimeoutMs);
  });

  // --- AC7: Timeout error includes provider, model, and elapsed time ---

  it('AC7: timeout error response includes provider, model, and elapsed time', async () => {
    mockLlmService.chat.mockRejectedValue(new Error('LLM request timed out'));

    const result = await controller.testChat();

    expect(result.success).toBe(false);
    // The error message should mention provider and model for diagnostics
    expect(result.response).toMatch(/provider/i);
    expect(result.response).toMatch(/model/i);
    expect(result.response).toMatch(/\d+/); // elapsed time in ms or seconds
  });

  it('AC7: includes provider name (e.g. "ollama") in timeout error', async () => {
    mockLlmService.chat.mockRejectedValue(new Error('LLM request timed out'));

    const result = await controller.testChat();

    expect(result.success).toBe(false);
    expect(result.response.toLowerCase()).toContain('ollama');
  });

  it('AC7: includes model name in timeout error', async () => {
    mockLlmService.chat.mockRejectedValue(new Error('LLM request timed out'));

    const result = await controller.testChat();

    expect(result.success).toBe(false);
    expect(result.response).toContain('llama3.2:3b');
  });

  // --- AC7: non-timeout errors still work ---

  it('returns generic error message for non-timeout failures', async () => {
    mockLlmService.chat.mockRejectedValue(new Error('Connection refused'));

    const result = await controller.testChat();

    expect(result.success).toBe(false);
    expect(result.response).toBeTruthy();
  });

  it('returns not-available message when provider is down', async () => {
    mockLlmService.isAvailable.mockResolvedValue(false);

    const result = await controller.testChat();

    expect(result.success).toBe(false);
    expect(result.response).toContain('No AI provider');
  });
});

// --- ROK-1019: AC4 — model resolution per provider ---

describe('ROK-1019: model resolution per provider', () => {
  let controller: AiAdminController;
  let mockLlmService: {
    isAvailable: jest.Mock;
    listModels: jest.Mock;
    chat: jest.Mock;
  };
  let mockRegistry: { resolveActive: jest.Mock };
  let mockLogService: { getUsageStats: jest.Mock };
  let mockSettings: { get: jest.Mock };

  function createCloudProvider(key: string, name: string): LlmProvider {
    return {
      key,
      displayName: name,
      requiresApiKey: true,
      selfHosted: false,
      isAvailable: jest.fn().mockResolvedValue(true),
      listModels: jest.fn().mockResolvedValue([]),
      chat: jest.fn(),
      generate: jest.fn(),
    };
  }

  beforeEach(async () => {
    mockLlmService = {
      isAvailable: jest.fn().mockResolvedValue(true),
      listModels: jest.fn().mockResolvedValue([]),
      chat: jest.fn().mockResolvedValue({
        content: 'Hello!',
        latencyMs: 150,
      }),
    };
    mockRegistry = {
      resolveActive: jest.fn().mockResolvedValue(
        createCloudProvider('google', 'Google (Gemini)'),
      ),
    };
    mockLogService = {
      getUsageStats: jest.fn().mockResolvedValue({
        totalRequests: 0,
        requestsToday: 0,
        avgLatencyMs: 0,
        errorRate: 0,
        byFeature: [],
      }),
    };
    // Simulate a stale Ollama model in the global ai_model setting
    mockSettings = { get: jest.fn().mockResolvedValue('llama3.2:3b') };

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

  describe('testChat error — cloud provider model resolution', () => {
    it('AC4: error includes cloud default model, not stale ollama model', async () => {
      mockLlmService.chat.mockRejectedValue(new Error('HTTP 404'));

      const result = await controller.testChat();

      expect(result.success).toBe(false);
      // Should show 'gemini-2.5-flash' (the cloud default), NOT 'llama3.2:3b'
      expect(result.response).toContain(CLOUD_DEFAULTS.google);
      expect(result.response).not.toContain('llama3.2:3b');
    });

    it('AC4: error includes openai cloud default when provider is openai', async () => {
      mockRegistry.resolveActive.mockResolvedValue(
        createCloudProvider('openai', 'OpenAI'),
      );
      mockLlmService.chat.mockRejectedValue(new Error('HTTP 401'));

      const result = await controller.testChat();

      expect(result.success).toBe(false);
      expect(result.response).toContain(CLOUD_DEFAULTS.openai);
      expect(result.response).not.toContain('llama3.2:3b');
    });
  });

  describe('testChat error — ollama keeps using ai_model setting', () => {
    it('AC4: ollama provider still uses the global ai_model setting', async () => {
      mockRegistry.resolveActive.mockResolvedValue({
        key: 'ollama',
        displayName: 'Ollama (Local)',
        requiresApiKey: false,
        selfHosted: true,
        isAvailable: jest.fn().mockResolvedValue(true),
        listModels: jest.fn().mockResolvedValue([]),
        chat: jest.fn(),
        generate: jest.fn(),
      });
      mockLlmService.chat.mockRejectedValue(new Error('Connection refused'));

      const result = await controller.testChat();

      expect(result.success).toBe(false);
      expect(result.response).toContain('llama3.2:3b');
    });
  });

  describe('getStatus — cloud provider model resolution', () => {
    it('AC4: getStatus shows cloud default model when provider is google', async () => {
      const result = await controller.getStatus();

      // Should resolve to the cloud default, not the stale Ollama model
      expect(result.currentModel).toBe(CLOUD_DEFAULTS.google);
    });

    it('AC4: getStatus shows ai_model setting for ollama provider', async () => {
      mockRegistry.resolveActive.mockResolvedValue({
        key: 'ollama',
        displayName: 'Ollama (Local)',
        requiresApiKey: false,
        selfHosted: true,
        isAvailable: jest.fn().mockResolvedValue(true),
        listModels: jest.fn().mockResolvedValue([]),
        chat: jest.fn(),
        generate: jest.fn(),
      });

      const result = await controller.getStatus();

      expect(result.currentModel).toBe('llama3.2:3b');
    });
  });
});
