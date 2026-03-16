import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { OllamaDockerService } from './ollama-docker.service';
import { OllamaModelService } from './ollama-model.service';
import { LlmProviderRegistry } from '../llm-provider-registry';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';
import type { SettingKey } from '../../drizzle/schema';
import type { AiOllamaSetupDto } from '@raid-ledger/contract';

/** Steps that indicate setup is actively running. */
const RUNNING_STEPS = new Set(['pulling_image', 'starting', 'pulling_model']);

/** Persisted setup state read from app_settings. */
export interface OllamaSetupState {
  running: boolean;
  step: string;
  error?: string;
}

/**
 * Manages the Ollama Docker setup lifecycle.
 * Persists setup progress to app_settings so state survives restarts.
 */
@Injectable()
export class OllamaSetupService {
  private readonly logger = new Logger(OllamaSetupService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly docker: OllamaDockerService,
    private readonly ollamaModel: OllamaModelService,
    private readonly registry: LlmProviderRegistry,
  ) {}

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

  /** Start the Ollama Docker setup process. */
  async startSetup(): Promise<AiOllamaSetupDto> {
    const dockerOk = await this.docker.isDockerAvailable();
    if (!dockerOk) {
      return {
        step: 'error',
        message: 'Docker is not available',
        success: false,
      };
    }
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
    await this.setStep('pulling_image');
    this.fireAndForgetSetup();
    return {
      step: 'starting',
      message: 'Setup started — poll providers for status',
      success: true,
    };
  }

  /** Launch runSetup() in the background without blocking the caller. */
  private fireAndForgetSetup(): void {
    void this.runSetup().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Ollama setup crashed: ${msg}`);
    });
  }

  /** Execute the full setup flow (pull image, start, pull model, persist config). */
  async runSetup(): Promise<void> {
    const status = await this.docker.getContainerStatus();
    if (status !== 'running') {
      await this.setStep('pulling_image');
      await this.docker.startContainer();
      await this.setStep('starting');
      await this.waitForHealth();
    }
    try {
      await this.setStep('pulling_model');
      await this.ollamaModel.pullModel(AI_DEFAULTS.model);
      await this.persistConfig();
      await this.setStep('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Ollama model pull failed: ${msg}`);
      await this.setStep('error');
      await this.settings.set(
        AI_SETTING_KEYS.OLLAMA_SETUP_ERROR as SettingKey,
        msg,
      );
    }
  }

  /** Persist URL, model, and provider to settings on success. */
  private async persistConfig(): Promise<void> {
    const network = await this.docker.getApiNetwork();
    const url = this.docker.getContainerUrl(network);
    await this.settings.set(AI_SETTING_KEYS.OLLAMA_URL as SettingKey, url);
    await this.settings.set(
      AI_SETTING_KEYS.MODEL as SettingKey,
      AI_DEFAULTS.model,
    );
    await this.settings.set(AI_SETTING_KEYS.PROVIDER as SettingKey, 'ollama');
  }

  /** Wait for Ollama to respond to health checks. */
  private async waitForHealth(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const provider = this.registry.resolve('ollama');
      try {
        if (provider && (await provider.isAvailable())) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.logger.error('Ollama health check exhausted all retries');
    await this.setStep('error');
    await this.settings.set(
      AI_SETTING_KEYS.OLLAMA_SETUP_ERROR as SettingKey,
      'Health check timed out',
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
