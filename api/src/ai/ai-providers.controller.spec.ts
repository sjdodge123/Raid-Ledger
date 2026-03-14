import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AiProvidersController } from './ai-providers.controller';
import { LlmProviderRegistry } from './llm-provider-registry';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { OllamaDockerService } from './providers/ollama-docker.service';
import { OllamaModelService } from './providers/ollama-model.service';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    key: 'ollama',
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    selfHosted: true,
    isAvailable: jest.fn().mockResolvedValue(true),
    listModels: jest.fn().mockResolvedValue([]),
    chat: jest.fn(),
    generate: jest.fn(),
    ...overrides,
  };
}

describe('AiProvidersController', () => {
  let controller: AiProvidersController;
  let mockRegistry: {
    list: jest.Mock;
    resolve: jest.Mock;
    resolveActive: jest.Mock;
  };
  let mockSettings: { get: jest.Mock; set: jest.Mock };
  let mockDocker: {
    isDockerAvailable: jest.Mock;
    getContainerStatus: jest.Mock;
    startContainer: jest.Mock;
    stopContainer: jest.Mock;
  };
  let mockOllamaModel: {
    pullModel: jest.Mock;
    isModelAvailable: jest.Mock;
  };

  beforeEach(async () => {
    mockRegistry = {
      list: jest.fn().mockReturnValue([]),
      resolve: jest.fn(),
      resolveActive: jest.fn().mockResolvedValue(undefined),
    };
    mockSettings = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    mockDocker = {
      isDockerAvailable: jest.fn().mockResolvedValue(true),
      getContainerStatus: jest.fn().mockResolvedValue('not-found'),
      startContainer: jest.fn().mockResolvedValue(undefined),
      stopContainer: jest.fn().mockResolvedValue(undefined),
    };
    mockOllamaModel = {
      pullModel: jest.fn().mockResolvedValue(undefined),
      isModelAvailable: jest.fn().mockResolvedValue(false),
    };

    const module = await Test.createTestingModule({
      controllers: [AiProvidersController],
      providers: [
        { provide: LlmProviderRegistry, useValue: mockRegistry },
        { provide: SettingsService, useValue: mockSettings },
        { provide: OllamaDockerService, useValue: mockDocker },
        { provide: OllamaModelService, useValue: mockOllamaModel },
        { provide: PluginRegistryService, useValue: { isActive: jest.fn() } },
        { provide: Reflector, useValue: new Reflector() },
      ],
    }).compile();
    controller = module.get(AiProvidersController);
  });

  describe('listProviders', () => {
    it('returns provider info with status flags', async () => {
      const provider = createMockProvider();
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');
      const result = await controller.listProviders();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        key: 'ollama',
        displayName: 'Ollama (Local)',
        available: true,
        active: true,
      });
    });

    it('marks cloud provider as configured when API key exists', async () => {
      const provider = createMockProvider({
        key: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        selfHosted: false,
      });
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('sk-test');
      const result = await controller.listProviders();
      expect(result[0].configured).toBe(true);
    });
  });

  describe('configureProvider', () => {
    it('saves API key for a cloud provider', async () => {
      const provider = createMockProvider({
        key: 'openai',
        requiresApiKey: true,
      });
      mockRegistry.resolve.mockReturnValue(provider);
      await controller.configureProvider('openai', {
        apiKey: 'sk-new-key',
      });
      expect(mockSettings.set).toHaveBeenCalledWith(
        'ai_openai_api_key',
        'sk-new-key',
      );
    });

    it('throws for unknown provider key', async () => {
      mockRegistry.resolve.mockReturnValue(undefined);
      await expect(
        controller.configureProvider('unknown', { apiKey: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('activateProvider', () => {
    it('sets the active provider in settings', async () => {
      const provider = createMockProvider({ key: 'openai' });
      mockRegistry.resolve.mockReturnValue(provider);
      await controller.activateProvider('openai');
      expect(mockSettings.set).toHaveBeenCalledWith('ai_provider', 'openai');
    });

    it('throws for unknown provider key', async () => {
      mockRegistry.resolve.mockReturnValue(undefined);
      await expect(controller.activateProvider('unknown')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('setupOllama', () => {
    it('returns error when Docker is not available', async () => {
      mockDocker.isDockerAvailable.mockResolvedValue(false);
      const result = await controller.setupOllama();
      expect(result.success).toBe(false);
      expect(result.step).toBe('error');
    });

    it('starts container and pulls model on success', async () => {
      mockDocker.isDockerAvailable.mockResolvedValue(true);
      mockDocker.getContainerStatus.mockResolvedValue('stopped');
      const result = await controller.setupOllama();
      expect(result.success).toBe(true);
      expect(result.step).toBe('ready');
      expect(mockDocker.startContainer).toHaveBeenCalled();
      expect(mockOllamaModel.pullModel).toHaveBeenCalled();
    });

    it('skips start if container is already running', async () => {
      mockDocker.isDockerAvailable.mockResolvedValue(true);
      mockDocker.getContainerStatus.mockResolvedValue('running');
      const result = await controller.setupOllama();
      expect(result.success).toBe(true);
      expect(mockDocker.startContainer).not.toHaveBeenCalled();
    });
  });

  describe('stopOllama', () => {
    it('stops the Ollama container', async () => {
      await controller.stopOllama();
      expect(mockDocker.stopContainer).toHaveBeenCalled();
    });
  });
});
