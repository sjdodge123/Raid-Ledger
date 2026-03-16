import { Test } from '@nestjs/testing';
import { OllamaSetupService } from './ollama-setup.service';
import { OllamaDockerService } from './ollama-docker.service';
import { OllamaModelService } from './ollama-model.service';
import { SettingsService } from '../../settings/settings.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';

jest.mock('./ollama.helpers', () => ({
  fetchOllama: jest.fn(),
}));

import { fetchOllama } from './ollama.helpers';

const mockFetchOllama = fetchOllama as jest.Mock;

describe('Regression: ROK-840', () => {
  describe('OllamaSetupService', () => {
    let service: OllamaSetupService;
    let mockSettings: Record<string, jest.Mock>;
    let mockDocker: Record<string, jest.Mock>;
    let mockModelService: Record<string, jest.Mock>;

    beforeEach(async () => {
      mockSettings = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      mockDocker = {
        isDockerAvailable: jest.fn().mockResolvedValue(true),
        getContainerStatus: jest.fn().mockResolvedValue('not-found'),
        startContainer: jest.fn().mockResolvedValue(undefined),
        stopContainer: jest.fn().mockResolvedValue(undefined),
        getApiNetwork: jest.fn().mockResolvedValue(null),
        getContainerUrl: jest.fn().mockReturnValue(AI_DEFAULTS.ollamaUrl),
      };
      mockModelService = {
        pullModel: jest.fn().mockResolvedValue(undefined),
      };
      // Default: health check succeeds immediately
      mockFetchOllama.mockResolvedValue({ models: [] });

      const module = await Test.createTestingModule({
        providers: [
          OllamaSetupService,
          { provide: SettingsService, useValue: mockSettings },
          { provide: OllamaDockerService, useValue: mockDocker },
          { provide: OllamaModelService, useValue: mockModelService },
        ],
      }).compile();

      service = module.get(OllamaSetupService);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('getSetupState', () => {
      it('should return idle state when no setup step in DB', async () => {
        mockSettings.get.mockResolvedValue(null);

        const state = await service.getSetupState();

        expect(state).toMatchObject({
          running: false,
          step: '',
          error: undefined,
        });
      });

      it('should return persisted step from DB', async () => {
        mockSettings.get.mockImplementation((key: string) => {
          if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'pulling_model';
          return null;
        });

        const state = await service.getSetupState();

        expect(state).toMatchObject({
          running: true,
          step: 'pulling_model',
        });
      });

      it('should return error state from DB', async () => {
        mockSettings.get.mockImplementation((key: string) => {
          if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'error';
          if (key === AI_SETTING_KEYS.OLLAMA_SETUP_ERROR)
            return 'Model pull failed';
          return null;
        });

        const state = await service.getSetupState();

        expect(state).toMatchObject({
          running: false,
          step: 'error',
          error: 'Model pull failed',
        });
      });

      it('should treat ready as not running', async () => {
        mockSettings.get.mockImplementation((key: string) => {
          if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
          return null;
        });

        const state = await service.getSetupState();

        expect(state.running).toBe(false);
        expect(state.step).toBe('ready');
      });
    });

    describe('startSetup', () => {
      it('should return error when Docker is unavailable', async () => {
        mockDocker.isDockerAvailable.mockResolvedValue(false);

        const result = await service.startSetup();

        expect(result).toMatchObject({
          step: 'error',
          success: false,
        });
      });

      it('should persist starting step to settings on success', async () => {
        const result = await service.startSetup();

        expect(result).toMatchObject({
          step: 'starting',
          success: true,
        });
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'pulling_image',
        );
      });

      it('should clear previous error on new setup start', async () => {
        await service.startSetup();

        expect(mockSettings.delete).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_ERROR,
        );
      });

      it('should return in-progress when setup already running', async () => {
        mockSettings.get.mockImplementation((key: string) => {
          if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'pulling_model';
          return null;
        });
        mockDocker.getContainerStatus.mockResolvedValue('running');

        const result = await service.startSetup();

        expect(result).toMatchObject({
          step: 'starting',
          message: expect.stringContaining('already'),
          success: true,
        });
      });
    });

    describe('runSetup', () => {
      it('should persist URL, model, and provider on completion', async () => {
        mockDocker.getContainerStatus.mockResolvedValue('running');
        mockDocker.getContainerUrl.mockReturnValue(
          'http://raid-ledger-ollama:11434',
        );

        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_URL,
          'http://raid-ledger-ollama:11434',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.MODEL,
          AI_DEFAULTS.model,
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.PROVIDER,
          'ollama',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'ready',
        );
      });

      it('should persist error state when model pull fails', async () => {
        mockDocker.getContainerStatus.mockResolvedValue('running');
        mockModelService.pullModel.mockRejectedValue(
          new Error('Network timeout'),
        );

        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'error',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_ERROR,
          'Network timeout',
        );
      });

      it('should start container when not running', async () => {
        mockDocker.getContainerStatus.mockResolvedValue('not-found');

        await service.runSetup();

        expect(mockDocker.startContainer).toHaveBeenCalled();
      });

      it('should skip starting container when already running', async () => {
        mockDocker.getContainerStatus.mockResolvedValue('running');

        await service.runSetup();

        expect(mockDocker.startContainer).not.toHaveBeenCalled();
      });

      it('should use container URL for health check, not provider settings', async () => {
        mockDocker.getContainerStatus.mockResolvedValue('not-found');
        mockDocker.getApiNetwork.mockResolvedValue('my-network');
        mockDocker.getContainerUrl.mockReturnValue(
          'http://raid-ledger-ollama:11434',
        );

        await service.runSetup();

        expect(mockFetchOllama).toHaveBeenCalledWith(
          'http://raid-ledger-ollama:11434',
          '/api/tags',
          expect.objectContaining({ timeoutMs: 3_000 }),
        );
      });

      it('should abort and persist error when health check times out', async () => {
        jest.useFakeTimers();
        mockDocker.getContainerStatus.mockResolvedValue('not-found');
        mockFetchOllama.mockRejectedValue(new Error('ECONNREFUSED'));

        const setupPromise = service.runSetup();
        for (let i = 0; i < 30; i++) {
          await jest.advanceTimersByTimeAsync(2000);
        }
        await setupPromise;

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'error',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_ERROR,
          'Health check timed out',
        );
        expect(mockModelService.pullModel).not.toHaveBeenCalled();
        jest.useRealTimers();
      });
    });
  });
});
