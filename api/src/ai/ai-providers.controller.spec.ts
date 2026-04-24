import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AiProvidersController } from './ai-providers.controller';
import { LlmProviderRegistry } from './llm-provider-registry';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { OllamaDockerService } from './providers/ollama-docker.service';
import { OllamaModelService } from './providers/ollama-model.service';
import { OllamaSetupService } from './providers/ollama-setup.service';
import { OllamaNativeService } from './providers/ollama-native.service';
import type { LlmProvider } from './llm-provider.interface';

function createMockProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    key: 'ollama',
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    selfHosted: true,
    defaultModel: 'mock-model',
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
  let mockNative: {
    isAllinoneMode: jest.Mock;
    getServiceStatus: jest.Mock;
    stopService: jest.Mock;
  };
  let mockSetupService: {
    getSetupState: jest.Mock;
    startSetup: jest.Mock;
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
    mockNative = {
      isAllinoneMode: jest.fn().mockReturnValue(false),
      getServiceStatus: jest.fn().mockResolvedValue('not-found'),
      stopService: jest.fn().mockResolvedValue(undefined),
    };
    mockSetupService = {
      getSetupState: jest.fn().mockResolvedValue({
        running: false,
        step: '',
        error: undefined,
      }),
      startSetup: jest.fn().mockResolvedValue({
        step: 'starting',
        message: 'Setup started',
        success: true,
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [AiProvidersController],
      providers: [
        { provide: LlmProviderRegistry, useValue: mockRegistry },
        { provide: SettingsService, useValue: mockSettings },
        { provide: OllamaDockerService, useValue: mockDocker },
        { provide: OllamaNativeService, useValue: mockNative },
        { provide: OllamaModelService, useValue: {} },
        { provide: OllamaSetupService, useValue: mockSetupService },
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
        defaultModel: 'mock-model',
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
    it('delegates to OllamaSetupService', async () => {
      const result = await controller.setupOllama();
      expect(mockSetupService.startSetup).toHaveBeenCalled();
      expect(result).toMatchObject({
        step: 'starting',
        success: true,
      });
    });
  });

  describe('stopOllama', () => {
    it('stops the Ollama container', async () => {
      await controller.stopOllama();
      expect(mockDocker.stopContainer).toHaveBeenCalled();
    });
  });

  describe('Regression: ROK-840', () => {
    it('reads setup state from DB, surviving page refresh', async () => {
      const provider = createMockProvider();
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');
      mockSetupService.getSetupState.mockResolvedValue({
        running: true,
        step: 'pulling_model',
        error: undefined,
      });

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(ollama!.setupInProgress).toBe(true);
      expect(ollama!.setupStep).toBe('pulling_model');
    });

    it('shows completed state after setup finishes', async () => {
      const provider = createMockProvider();
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');
      mockSetupService.getSetupState.mockResolvedValue({
        running: false,
        step: 'ready',
        error: undefined,
      });

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(ollama!.setupInProgress).toBe(false);
    });

    it('shows persisted error state after refresh', async () => {
      const provider = createMockProvider({
        isAvailable: jest.fn().mockResolvedValue(false),
      });
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');
      mockSetupService.getSetupState.mockResolvedValue({
        running: false,
        step: 'error',
        error: 'Model pull failed',
      });

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(ollama!.setupStep).toBe('error');
      expect(ollama!.error).toBe('Model pull failed');
    });
  });

  describe('ROK-882: Native Ollama', () => {
    it('AC8: stopOllama calls native stopService in allinone mode', async () => {
      mockNative.isAllinoneMode.mockReturnValue(true);

      await controller.stopOllama();

      expect(mockNative.stopService).toHaveBeenCalled();
      expect(mockDocker.stopContainer).not.toHaveBeenCalled();
    });

    it('AC9: enrichOllamaInfo uses native status in allinone mode', async () => {
      mockNative.isAllinoneMode.mockReturnValue(true);
      mockNative.getServiceStatus.mockResolvedValue('stopped');
      const provider = createMockProvider({
        isAvailable: jest.fn().mockResolvedValue(false),
      });
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(mockNative.getServiceStatus).toHaveBeenCalled();
      expect(ollama!.setupStep).toBe('container_exists');
    });

    it('AC11: Docker stop path still works in dev mode', async () => {
      mockNative.isAllinoneMode.mockReturnValue(false);

      await controller.stopOllama();

      expect(mockDocker.stopContainer).toHaveBeenCalled();
      expect(mockNative.stopService).not.toHaveBeenCalled();
    });
  });

  describe('ROK-882: adversarial controller paths', () => {
    it('stopOllama propagates error from native stopService', async () => {
      mockNative.isAllinoneMode.mockReturnValue(true);
      mockNative.stopService.mockRejectedValue(
        new Error('ERROR: ollama: ERROR (not running)'),
      );

      await expect(controller.stopOllama()).rejects.toThrow(
        'ERROR: ollama: ERROR (not running)',
      );
    });

    it('hasExistingInstall returns false when native status is not-found in allinone mode', async () => {
      mockNative.isAllinoneMode.mockReturnValue(true);
      mockNative.getServiceStatus.mockResolvedValue('not-found');
      const provider = createMockProvider({
        isAvailable: jest.fn().mockResolvedValue(false),
      });
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(ollama!.setupStep).toBeUndefined();
    });

    it('hasExistingInstall uses docker in non-allinone mode and returns false when not-found', async () => {
      mockNative.isAllinoneMode.mockReturnValue(false);
      mockDocker.getContainerStatus.mockResolvedValue('not-found');
      const provider = createMockProvider({
        isAvailable: jest.fn().mockResolvedValue(false),
      });
      mockRegistry.list.mockReturnValue([provider]);
      mockSettings.get.mockResolvedValue('ollama');

      const result = await controller.listProviders();
      const ollama = result.find((p) => p.key === 'ollama');

      expect(mockDocker.getContainerStatus).toHaveBeenCalled();
      expect(ollama!.setupStep).toBeUndefined();
    });

    it('configureProvider throws BadRequestException when body has no fields', async () => {
      const provider = createMockProvider({
        key: 'openai',
        requiresApiKey: true,
      });
      mockRegistry.resolve.mockReturnValue(provider);

      await expect(controller.configureProvider('openai', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stopOllama returns success:true on successful native stop', async () => {
      mockNative.isAllinoneMode.mockReturnValue(true);
      mockNative.stopService.mockResolvedValue(undefined);

      const result = await controller.stopOllama();

      expect(result).toEqual({ success: true });
    });
  });
});
