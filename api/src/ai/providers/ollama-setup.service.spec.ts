import { Test } from '@nestjs/testing';
import type { OnModuleInit } from '@nestjs/common';
import { OllamaSetupService } from './ollama-setup.service';
import { OllamaDockerService } from './ollama-docker.service';
import { OllamaModelService } from './ollama-model.service';
import { OllamaNativeService } from './ollama-native.service';
import { SettingsService } from '../../settings/settings.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';

/** Helper to call onModuleInit safely on a service that may or may not implement it. */
function callOnModuleInit(svc: OllamaSetupService): Promise<void> {
  return (svc as unknown as OnModuleInit).onModuleInit() as Promise<void>;
}

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
    let mockNative: Record<string, jest.Mock>;

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
      mockNative = {
        isAllinoneMode: jest.fn().mockReturnValue(false),
        getServiceStatus: jest.fn().mockResolvedValue('not-found'),
        install: jest.fn().mockResolvedValue(undefined),
        writeSupervisorConfig: jest.fn(),
        startService: jest.fn().mockResolvedValue(undefined),
        isBinaryInstalled: jest.fn().mockReturnValue(false),
        getOllamaUrl: jest.fn().mockReturnValue('http://localhost:11434'),
      };
      // Default: health check succeeds immediately
      mockFetchOllama.mockResolvedValue({ models: [] });

      const module = await Test.createTestingModule({
        providers: [
          OllamaSetupService,
          { provide: SettingsService, useValue: mockSettings },
          { provide: OllamaDockerService, useValue: mockDocker },
          { provide: OllamaModelService, useValue: mockModelService },
          { provide: OllamaNativeService, useValue: mockNative },
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

describe('ROK-882: Native Ollama Install', () => {
  describe('OllamaSetupService — native path', () => {
    let service: OllamaSetupService;
    let mockSettings: Record<string, jest.Mock>;
    let mockDocker: Record<string, jest.Mock>;
    let mockModelService: Record<string, jest.Mock>;
    let mockNative: Record<string, jest.Mock>;

    beforeEach(async () => {
      mockSettings = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      mockDocker = {
        isDockerAvailable: jest.fn().mockResolvedValue(false),
        getContainerStatus: jest.fn().mockResolvedValue('not-found'),
        startContainer: jest.fn().mockResolvedValue(undefined),
        stopContainer: jest.fn().mockResolvedValue(undefined),
        getApiNetwork: jest.fn().mockResolvedValue(null),
        getContainerUrl: jest.fn().mockReturnValue(AI_DEFAULTS.ollamaUrl),
      };
      mockModelService = {
        pullModel: jest.fn().mockResolvedValue(undefined),
      };
      mockNative = {
        isAllinoneMode: jest.fn().mockReturnValue(true),
        getServiceStatus: jest.fn().mockResolvedValue('not-found'),
        install: jest.fn().mockResolvedValue(undefined),
        writeSupervisorConfig: jest.fn(),
        startService: jest.fn().mockResolvedValue(undefined),
        isBinaryInstalled: jest.fn().mockReturnValue(false),
        getOllamaUrl: jest.fn().mockReturnValue('http://localhost:11434'),
      };
      mockFetchOllama.mockResolvedValue({ models: [] });

      const module = await Test.createTestingModule({
        providers: [
          OllamaSetupService,
          { provide: SettingsService, useValue: mockSettings },
          { provide: OllamaDockerService, useValue: mockDocker },
          { provide: OllamaModelService, useValue: mockModelService },
          { provide: OllamaNativeService, useValue: mockNative },
        ],
      }).compile();

      service = module.get(OllamaSetupService);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('startSetup — AC1', () => {
      it('returns success when Docker unavailable but allinone mode', async () => {
        const result = await service.startSetup();

        expect(result).toMatchObject({
          step: 'starting',
          success: true,
        });
      });

      it('returns Docker error when not allinone and no Docker', async () => {
        mockNative.isAllinoneMode.mockReturnValue(false);

        const result = await service.startSetup();

        expect(result).toMatchObject({
          step: 'error',
          success: false,
        });
      });
    });

    describe('runSetup — native path', () => {
      it('AC2: installs binary when not already installed', async () => {
        mockNative.isBinaryInstalled.mockReturnValue(false);

        await service.runSetup();

        expect(mockNative.install).toHaveBeenCalled();
      });

      it('AC3: writes supervisor config', async () => {
        await service.runSetup();

        expect(mockNative.writeSupervisorConfig).toHaveBeenCalled();
      });

      it('AC4: starts service via supervisorctl', async () => {
        await service.runSetup();

        expect(mockNative.startService).toHaveBeenCalled();
      });

      it('AC5: polls health check at localhost:11434', async () => {
        await service.runSetup();

        expect(mockFetchOllama).toHaveBeenCalledWith(
          'http://localhost:11434',
          '/api/tags',
          expect.objectContaining({ timeoutMs: 3_000 }),
        );
      });

      it('AC6: pulls model after health check passes', async () => {
        await service.runSetup();

        expect(mockModelService.pullModel).toHaveBeenCalledWith(
          AI_DEFAULTS.model,
        );
      });

      it('AC7: persists URL, model, and provider settings', async () => {
        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_URL,
          'http://localhost:11434',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.MODEL,
          AI_DEFAULTS.model,
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.PROVIDER,
          'ollama',
        );
      });

      it('sets step to ready on completion', async () => {
        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'ready',
        );
      });

      it('AC12: persists error when install fails', async () => {
        mockNative.install.mockRejectedValue(
          new Error('Download failed: HTTP 500'),
        );

        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'error',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_ERROR,
          'Download failed: HTTP 500',
        );
      });

      it('skips install when binary already present', async () => {
        mockNative.isBinaryInstalled.mockReturnValue(true);
        mockNative.getServiceStatus.mockResolvedValue('running');

        await service.runSetup();

        expect(mockNative.install).not.toHaveBeenCalled();
      });

      it('writes supervisor config and starts when binary exists but service not-found', async () => {
        mockNative.isBinaryInstalled.mockReturnValue(true);
        mockNative.getServiceStatus.mockResolvedValue('not-found');

        await service.runSetup();

        expect(mockNative.install).not.toHaveBeenCalled();
        expect(mockNative.writeSupervisorConfig).toHaveBeenCalled();
        expect(mockNative.startService).toHaveBeenCalled();
      });

      it('persists error when startService throws', async () => {
        mockNative.startService.mockRejectedValue(
          new Error('ERROR (abnormal termination)'),
        );

        await service.runSetup();

        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'error',
        );
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_ERROR,
          'ERROR (abnormal termination)',
        );
      });

      it('first step in startSetup is downloading_binary (not pulling_image) in native mode', async () => {
        const result = await service.startSetup();

        expect(result.success).toBe(true);
        expect(mockSettings.set).toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'downloading_binary',
        );
        expect(mockSettings.set).not.toHaveBeenCalledWith(
          AI_SETTING_KEYS.OLLAMA_SETUP_STEP,
          'pulling_image',
        );
      });
    });
  });
});

describe('ROK-882: Docker available but allinone mode — native path wins', () => {
  describe('OllamaSetupService — docker-available-but-allinone', () => {
    let service: OllamaSetupService;
    let mockSettings: Record<string, jest.Mock>;
    let mockDocker: Record<string, jest.Mock>;
    let mockModelService: Record<string, jest.Mock>;
    let mockNative: Record<string, jest.Mock>;

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
      mockNative = {
        isAllinoneMode: jest.fn().mockReturnValue(true),
        getServiceStatus: jest.fn().mockResolvedValue('not-found'),
        install: jest.fn().mockResolvedValue(undefined),
        writeSupervisorConfig: jest.fn(),
        startService: jest.fn().mockResolvedValue(undefined),
        isBinaryInstalled: jest.fn().mockReturnValue(false),
        getOllamaUrl: jest.fn().mockReturnValue('http://localhost:11434'),
      };
      mockFetchOllama.mockResolvedValue({ models: [] });

      const module = await Test.createTestingModule({
        providers: [
          OllamaSetupService,
          { provide: SettingsService, useValue: mockSettings },
          { provide: OllamaDockerService, useValue: mockDocker },
          { provide: OllamaModelService, useValue: mockModelService },
          { provide: OllamaNativeService, useValue: mockNative },
        ],
      }).compile();

      service = module.get(OllamaSetupService);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('uses native path when both Docker and allinone mode are active', async () => {
      await service.runSetup();

      expect(mockNative.startService).toHaveBeenCalled();
      expect(mockDocker.startContainer).not.toHaveBeenCalled();
    });

    it('persists localhost URL (not docker container URL) when allinone wins', async () => {
      mockDocker.getContainerUrl.mockReturnValue(
        'http://raid-ledger-ollama:11434',
      );

      await service.runSetup();

      expect(mockSettings.set).toHaveBeenCalledWith(
        AI_SETTING_KEYS.OLLAMA_URL,
        'http://localhost:11434',
      );
      expect(mockSettings.set).not.toHaveBeenCalledWith(
        AI_SETTING_KEYS.OLLAMA_URL,
        'http://raid-ledger-ollama:11434',
      );
    });

    it('does not call docker startContainer when allinone wins', async () => {
      await service.runSetup();

      expect(mockDocker.startContainer).not.toHaveBeenCalled();
    });
  });
});

// --- ROK-1000: Auto-recovery on container rebuild (onModuleInit) ---

/**
 * Shared mock factory for ROK-1000 auto-recovery tests.
 * Mirrors the constructor dependencies of OllamaSetupService.
 */
function createRecoveryMocks() {
  return {
    settings: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    docker: {
      isDockerAvailable: jest.fn().mockResolvedValue(false),
      getContainerStatus: jest.fn().mockResolvedValue('not-found' as const),
      startContainer: jest.fn().mockResolvedValue(undefined),
      stopContainer: jest.fn().mockResolvedValue(undefined),
      getApiNetwork: jest.fn().mockResolvedValue(null),
      getContainerUrl: jest.fn().mockReturnValue('http://localhost:11434'),
    },
    ollamaModel: {
      pullModel: jest.fn().mockResolvedValue(undefined),
    },
    native: {
      isAllinoneMode: jest.fn().mockReturnValue(false),
      isBinaryInstalled: jest.fn().mockReturnValue(false),
      getServiceStatus: jest.fn().mockResolvedValue('not-found' as const),
      writeSupervisorConfig: jest.fn(),
      startService: jest.fn().mockResolvedValue(undefined),
      stopService: jest.fn().mockResolvedValue(undefined),
      install: jest.fn().mockResolvedValue(undefined),
      getOllamaUrl: jest.fn().mockReturnValue('http://localhost:11434'),
    },
  };
}

async function buildRecoveryModule(
  mocks: ReturnType<typeof createRecoveryMocks>,
) {
  mockFetchOllama.mockResolvedValue({ models: [] });
  const module = await Test.createTestingModule({
    providers: [
      OllamaSetupService,
      { provide: SettingsService, useValue: mocks.settings },
      { provide: OllamaDockerService, useValue: mocks.docker },
      { provide: OllamaModelService, useValue: mocks.ollamaModel },
      { provide: OllamaNativeService, useValue: mocks.native },
    ],
  }).compile();
  return module.get(OllamaSetupService);
}

/** Configure mocks: DB says ready + allinone + binary missing (container rebuild). */
function configureContainerRebuild(
  mocks: ReturnType<typeof createRecoveryMocks>,
) {
  mocks.native.isAllinoneMode.mockReturnValue(true);
  mocks.native.isBinaryInstalled.mockReturnValue(false);
  mocks.native.getServiceStatus.mockResolvedValue('not-found');
  mocks.settings.get.mockImplementation((key: string) => {
    if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
    if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
    return null;
  });
}

/** Configure mocks: binary exists but supervisor service is stopped. */
function configureBinaryExistsStopped(
  mocks: ReturnType<typeof createRecoveryMocks>,
) {
  mocks.native.isAllinoneMode.mockReturnValue(true);
  mocks.native.isBinaryInstalled.mockReturnValue(true);
  mocks.native.getServiceStatus.mockResolvedValue('stopped');
  mocks.settings.get.mockImplementation((key: string) => {
    if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
    if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
    return null;
  });
}

describe('ROK-1000: onModuleInit auto-recovery', () => {
  let service: OllamaSetupService;
  let mocks: ReturnType<typeof createRecoveryMocks>;

  beforeEach(async () => {
    mocks = createRecoveryMocks();
    service = await buildRecoveryModule(mocks);
    jest.clearAllMocks();
    mockFetchOllama.mockResolvedValue({ models: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --- AC1: After container rebuild, Ollama auto-recovers ---

  it('AC1: implements OnModuleInit (has onModuleInit method)', () => {
    const hook = service as unknown as OnModuleInit;
    expect(typeof hook.onModuleInit).toBe('function');
  });

  it('AC1: triggers runSetup when binary is missing and DB says ready', async () => {
    configureContainerRebuild(mocks);
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();

    await callOnModuleInit(service);
    // Allow fire-and-forget to dispatch
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).toHaveBeenCalled();
  });

  // --- AC2: Recovery runs in background, does not block startup ---

  it('AC2: onModuleInit returns immediately without awaiting runSetup', async () => {
    configureContainerRebuild(mocks);
    service = await buildRecoveryModule(mocks);

    // Make runSetup hang forever (simulating a 2.5-minute download)
    jest.spyOn(service, 'runSetup').mockReturnValue(new Promise(() => {}));

    const start = Date.now();
    await callOnModuleInit(service);
    const elapsed = Date.now() - start;

    // Should complete in well under 1s — it fires and forgets
    expect(elapsed).toBeLessThan(1000);
  });

  // --- AC3: Recovery logs clearly indicate what's happening ---

  it('AC3: logs a recovery-start message when auto-recovery triggers', async () => {
    configureContainerRebuild(mocks);
    service = await buildRecoveryModule(mocks);

    const logger = (service as unknown as { logger: { log: jest.Mock } })
      .logger;
    const logSpy = jest.spyOn(logger, 'log');
    jest.spyOn(service, 'runSetup').mockResolvedValue();

    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    const logMessages = logSpy.mock.calls.map((c) => String(c[0]));
    const hasRecoveryLog = logMessages.some(
      (msg) =>
        msg.toLowerCase().includes('auto-recover') ||
        msg.toLowerCase().includes('recovering'),
    );
    expect(hasRecoveryLog).toBe(true);
  });

  // --- AC4: Binary exists + service stopped => restart only, no install ---

  it('AC4: restarts without installing when binary exists but service is stopped', async () => {
    configureBinaryExistsStopped(mocks);
    service = await buildRecoveryModule(mocks);

    await callOnModuleInit(service);
    // Allow background work to run
    await new Promise((r) => setTimeout(r, 100));

    expect(mocks.native.writeSupervisorConfig).toHaveBeenCalled();
    expect(mocks.native.startService).toHaveBeenCalled();
    expect(mocks.native.install).not.toHaveBeenCalled();
  });

  // --- AC5: Conditions where recovery should NOT run ---

  it('AC5: skips recovery when provider is not ollama', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(true);
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'openai';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
    expect(mocks.native.isBinaryInstalled).not.toHaveBeenCalled();
  });

  it('AC5: skips recovery when setup was never completed (step is error)', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(true);
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'error';
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
  });

  it('AC5: skips recovery when not in allinone mode', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(false);
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
  });

  it('AC5: skips recovery when setup step is empty string', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(true);
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return '';
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
  });

  it('AC5: skips recovery when setup step is null (never set)', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(true);
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return null;
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
  });

  // --- Edge: binary + service already running => no recovery needed ---

  it('no-op when binary exists and service is already running', async () => {
    mocks.native.isAllinoneMode.mockReturnValue(true);
    mocks.native.isBinaryInstalled.mockReturnValue(true);
    mocks.native.getServiceStatus.mockResolvedValue('running');
    mocks.settings.get.mockImplementation((key: string) => {
      if (key === AI_SETTING_KEYS.PROVIDER) return 'ollama';
      if (key === AI_SETTING_KEYS.OLLAMA_SETUP_STEP) return 'ready';
      return null;
    });
    service = await buildRecoveryModule(mocks);

    const runSetupSpy = jest.spyOn(service, 'runSetup').mockResolvedValue();
    await callOnModuleInit(service);
    await new Promise((r) => setImmediate(r));

    expect(runSetupSpy).not.toHaveBeenCalled();
    expect(mocks.native.writeSupervisorConfig).not.toHaveBeenCalled();
    expect(mocks.native.startService).not.toHaveBeenCalled();
  });

  // --- AC10: Model re-pull during recovery ---

  it('AC10: runSetup calls pullModel (fast when model already on persistent volume)', async () => {
    configureContainerRebuild(mocks);
    service = await buildRecoveryModule(mocks);

    await callOnModuleInit(service);
    // Allow background runSetup to complete
    await new Promise((r) => setTimeout(r, 200));

    expect(mocks.ollamaModel.pullModel).toHaveBeenCalledWith(AI_DEFAULTS.model);
  });
});
