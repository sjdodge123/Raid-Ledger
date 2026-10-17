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

    // Use a deferred promise so we can resolve it in cleanup,
    // preventing a dangling promise that causes Jest "did not exit" warnings.
    let resolveHang!: () => void;
    const hangPromise = new Promise<void>((r) => {
      resolveHang = r;
    });
    jest.spyOn(service, 'runSetup').mockReturnValue(hangPromise);

    const start = Date.now();
    await callOnModuleInit(service);
    const elapsed = Date.now() - start;

    // Should complete in well under 1s — it fires and forgets
    expect(elapsed).toBeLessThan(1000);

    // Resolve the dangling promise to allow clean Jest exit
    resolveHang();
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
