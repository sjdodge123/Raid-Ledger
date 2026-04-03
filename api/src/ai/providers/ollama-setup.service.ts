import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { OllamaDockerService } from './ollama-docker.service';
import { OllamaModelService } from './ollama-model.service';
import { OllamaNativeService } from './ollama-native.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';
import { bestEffortInit } from '../../common/lifecycle.util';
import type { SettingKey } from '../../drizzle/schema';
import type { AiOllamaSetupDto } from '@raid-ledger/contract';
import { fetchOllama } from './ollama.helpers';
import type { OllamaRawModel } from './ollama.helpers';

/** Steps that indicate setup is actively running. */
const RUNNING_STEPS = new Set([
  'downloading_binary',
  'pulling_image',
  'starting',
  'pulling_model',
]);

/** Persisted setup state read from app_settings. */
export interface OllamaSetupState {
  running: boolean;
  step: string;
  error?: string;
}

/**
 * Manages the Ollama setup lifecycle for both Docker and native modes.
 * Persists setup progress to app_settings so state survives restarts.
 */
@Injectable()
export class OllamaSetupService implements OnModuleInit {
  private readonly logger = new Logger(OllamaSetupService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly docker: OllamaDockerService,
    private readonly ollamaModel: OllamaModelService,
    private readonly native: OllamaNativeService,
  ) {}

  /** Auto-recover Ollama after container rebuild (non-blocking). */
  async onModuleInit(): Promise<void> {
    await bestEffortInit('OllamaAutoRecovery', this.logger, async () => {
      if (!this.native.isAllinoneMode()) return;
      const provider = await this.getSetting(AI_SETTING_KEYS.PROVIDER);
      const step = await this.getSetting(AI_SETTING_KEYS.OLLAMA_SETUP_STEP);
      if (provider !== 'ollama' || step !== 'ready') return;
      await this.recoverIfNeeded();
    });
  }

  /** Check binary/service state and dispatch the appropriate recovery. */
  private async recoverIfNeeded(): Promise<void> {
    if (!this.native.isBinaryInstalled()) {
      this.logger.log(
        'Ollama binary missing after container rebuild — auto-recovering',
      );
      this.fireAndForgetSetup();
      return;
    }
    const status = await this.native.getServiceStatus();
    if (status !== 'running') {
      this.logger.log('Ollama service stopped — restarting');
      void this.restartService();
      return;
    }
  }

  /** Restart the supervisor service without re-downloading. */
  private async restartService(): Promise<void> {
    try {
      this.native.writeSupervisorConfig();
      await this.native.startService();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Ollama restart failed: ${msg}`);
    }
  }

  /** Read persisted setup state from DB. */
  async getSetupState(): Promise<OllamaSetupState> {
    const step = await this.getSetting(AI_SETTING_KEYS.OLLAMA_SETUP_STEP);
    const error = await this.getSetting(AI_SETTING_KEYS.OLLAMA_SETUP_ERROR);
    const running = RUNNING_STEPS.has(step ?? '');
    return {
      running,
      step: step ?? '',
      error: error ?? undefined,
    };
  }

  /** Start the Ollama setup process (Docker or native). */
  async startSetup(): Promise<AiOllamaSetupDto> {
    const dockerOk = await this.docker.isDockerAvailable();
    if (!dockerOk && !this.native.isAllinoneMode()) {
      return {
        step: 'error',
        message: 'Docker is not available',
        success: false,
      };
    }
    return this.beginSetup(dockerOk);
  }

  /** Execute the full setup flow, dispatching to Docker or native. */
  async runSetup(): Promise<void> {
    try {
      if (this.native.isAllinoneMode()) {
        await this.runNativeInstall();
      } else {
        await this.runDockerInstall();
      }
      await this.pullModelAndPersist();
    } catch (e) {
      await this.handleSetupError(e);
    }
  }

  /** Launch runSetup() in the background without blocking the caller. */
  private fireAndForgetSetup(): void {
    void this.runSetup().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Ollama setup crashed: ${msg}`);
    });
  }

  /** Check state, clear errors, and fire off setup in background. */
  private async beginSetup(dockerOk: boolean): Promise<AiOllamaSetupDto> {
    const state = await this.getSetupState();
    if (state.running) {
      return {
        step: 'starting',
        message: 'Setup already in progress',
        success: true,
      };
    }
    await this.settings.delete(
      AI_SETTING_KEYS.OLLAMA_SETUP_ERROR as SettingKey,
    );
    const firstStep = dockerOk ? 'pulling_image' : 'downloading_binary';
    await this.setStep(firstStep);
    this.fireAndForgetSetup();
    return {
      step: 'starting',
      message: 'Setup started — poll providers for status',
      success: true,
    };
  }

  /** Install and start Ollama natively via supervisor. */
  private async runNativeInstall(): Promise<void> {
    const status = await this.native.getServiceStatus();
    if (status === 'running') return;
    if (!this.native.isBinaryInstalled()) {
      await this.setStep('downloading_binary');
      await this.native.install();
    }
    this.native.writeSupervisorConfig();
    await this.native.startService();
    await this.setStep('starting');
    await this.waitForHealth(this.native.getOllamaUrl());
  }

  /** Install and start Ollama via Docker. */
  private async runDockerInstall(): Promise<void> {
    const status = await this.docker.getContainerStatus();
    if (status === 'running') return;
    await this.setStep('pulling_image');
    await this.docker.startContainer();
    await this.setStep('starting');
    const network = await this.docker.getApiNetwork();
    const url = this.docker.getContainerUrl(network);
    await this.waitForHealth(url);
  }

  /** Pull model and persist config (shared between Docker and native). */
  private async pullModelAndPersist(): Promise<void> {
    await this.setStep('pulling_model');
    await this.ollamaModel.pullModel(AI_DEFAULTS.model);
    await this.persistConfig();
    await this.setStep('ready');
  }

  /** Persist URL, model, and provider to settings on success. */
  private async persistConfig(): Promise<void> {
    const url = this.native.isAllinoneMode()
      ? this.native.getOllamaUrl()
      : this.docker.getContainerUrl(await this.docker.getApiNetwork());
    await this.settings.set(AI_SETTING_KEYS.OLLAMA_URL as SettingKey, url);
    await this.settings.set(
      AI_SETTING_KEYS.MODEL as SettingKey,
      AI_DEFAULTS.model,
    );
    await this.settings.set(AI_SETTING_KEYS.PROVIDER as SettingKey, 'ollama');
  }

  /**
   * Wait for Ollama to respond to health checks. Throws on timeout.
   * @param url - The base URL to poll (Docker container or localhost)
   */
  private async waitForHealth(url: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const data = await fetchOllama<{ models: OllamaRawModel[] }>(
          url,
          '/api/tags',
          { timeoutMs: 3_000 },
        );
        if ((data.models ?? []).length >= 0) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await this.persistHealthTimeout();
    throw new Error('Ollama health check timed out');
  }

  /** Persist timeout error state. */
  private async persistHealthTimeout(): Promise<void> {
    this.logger.error('Ollama health check exhausted all retries');
    await this.setStep('error');
    await this.settings.set(
      AI_SETTING_KEYS.OLLAMA_SETUP_ERROR as SettingKey,
      'Health check timed out',
    );
  }

  /** Handle setup errors by persisting error state. */
  private async handleSetupError(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    this.logger.error(`Ollama setup failed: ${msg}`);
    await this.setStep('error');
    await this.settings.set(
      AI_SETTING_KEYS.OLLAMA_SETUP_ERROR as SettingKey,
      msg,
    );
  }

  /** Persist a setup step to settings. */
  private async setStep(step: string): Promise<void> {
    await this.settings.set(
      AI_SETTING_KEYS.OLLAMA_SETUP_STEP as SettingKey,
      step,
    );
  }

  /** Get a setting value by AI setting key. */
  private async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key as SettingKey);
  }
}
