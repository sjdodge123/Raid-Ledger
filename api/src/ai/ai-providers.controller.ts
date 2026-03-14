import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugins/plugin-host/plugin-active.guard';
import { LlmProviderRegistry } from './llm-provider-registry';
import { SettingsService } from '../settings/settings.service';
import { OllamaDockerService } from './providers/ollama-docker.service';
import { OllamaModelService } from './providers/ollama-model.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from './llm.constants';
import { getApiKeySettingKey, buildProviderInfo } from './ai-providers.helpers';
import type { AiProviderInfoDto } from './ai-providers.helpers';
import type { SettingKey } from '../drizzle/schema';

/** Request body for configuring a provider. */
interface ConfigureBody {
  apiKey?: string;
  url?: string;
  model?: string;
}

/** Response from the Ollama setup endpoint. */
interface OllamaSetupResult {
  step: string;
  message: string;
  success: boolean;
}

/**
 * Admin endpoints for managing AI providers.
 */
@Controller('admin/ai/providers')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin('ai')
export class AiProvidersController {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly settings: SettingsService,
    private readonly docker: OllamaDockerService,
    private readonly ollamaModel: OllamaModelService,
  ) {}

  /** GET /admin/ai/providers — List all providers with status. */
  @Get()
  async listProviders(): Promise<AiProviderInfoDto[]> {
    const providers = this.registry.list();
    const activeKey = await this.getActiveProviderKey();
    return Promise.all(providers.map((p) => this.buildInfo(p, activeKey)));
  }

  /** POST /admin/ai/providers/:key/configure — Save provider config. */
  @Post(':key/configure')
  async configureProvider(
    @Param('key') key: string,
    @Body() body: ConfigureBody,
  ): Promise<{ success: boolean }> {
    this.requireKnownProvider(key);
    if (body.apiKey) {
      const settingKey = getApiKeySettingKey(key);
      if (settingKey) {
        await this.settings.set(settingKey as SettingKey, body.apiKey);
      }
    }
    if (body.url && key === 'ollama') {
      await this.settings.set(
        AI_SETTING_KEYS.OLLAMA_URL as SettingKey,
        body.url,
      );
    }
    if (body.model) {
      await this.settings.set(AI_SETTING_KEYS.MODEL as SettingKey, body.model);
    }
    return { success: true };
  }

  /** POST /admin/ai/providers/:key/activate — Set as active provider. */
  @Post(':key/activate')
  async activateProvider(
    @Param('key') key: string,
  ): Promise<{ success: boolean }> {
    this.requireKnownProvider(key);
    await this.settings.set(AI_SETTING_KEYS.PROVIDER as SettingKey, key);
    return { success: true };
  }

  /** POST /admin/ai/providers/ollama/setup — Start async Docker setup. */
  @Post('ollama/setup')
  async setupOllama(): Promise<OllamaSetupResult> {
    const dockerOk = await this.docker.isDockerAvailable();
    if (!dockerOk) {
      return { step: 'error', message: 'Docker is not available', success: false };
    }
    if (this.ollamaSetupRunning) {
      return { step: 'starting', message: 'Setup already in progress', success: true };
    }
    this.ollamaSetupRunning = true;
    this.runOllamaSetup().finally(() => { this.ollamaSetupRunning = false; });
    return { step: 'starting', message: 'Setup started — poll providers for status', success: true };
  }

  private ollamaSetupRunning = false;

  private async runOllamaSetup(): Promise<void> {
    const status = await this.docker.getContainerStatus();
    if (status !== 'running') {
      await this.docker.startContainer();
      await this.waitForOllamaHealth();
    }
    try {
      await this.ollamaModel.pullModel(AI_DEFAULTS.model);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Ollama model pull failed: ${msg}`);
    }
  }

  private async waitForOllamaHealth(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const provider = this.registry.resolve('ollama');
      try {
        if (provider && (await provider.isAvailable())) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private readonly logger = new Logger(AiProvidersController.name);

  /** POST /admin/ai/providers/ollama/stop — Stop Ollama container. */
  @Post('ollama/stop')
  async stopOllama(): Promise<{ success: boolean }> {
    await this.docker.stopContainer();
    return { success: true };
  }

  /** Resolve active provider key from settings. */
  private async getActiveProviderKey(): Promise<string> {
    return (
      (await this.settings.get(AI_SETTING_KEYS.PROVIDER as SettingKey)) ??
      AI_DEFAULTS.provider
    );
  }

  /** Build provider info including configuration and availability. */
  private async buildInfo(
    provider: {
      key: string;
      displayName: string;
      requiresApiKey: boolean;
      selfHosted: boolean;
      isAvailable: () => Promise<boolean>;
    },
    activeKey: string,
  ): Promise<AiProviderInfoDto> {
    const configured = await this.isConfigured(provider);
    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      /* provider unavailable */
    }
    return buildProviderInfo(
      provider as never,
      configured,
      available,
      provider.key === activeKey,
    );
  }

  /** Check if a provider is configured (has API key or is self-hosted). */
  private async isConfigured(provider: {
    key: string;
    requiresApiKey: boolean;
  }): Promise<boolean> {
    if (!provider.requiresApiKey) return true;
    const settingKey = getApiKeySettingKey(provider.key);
    if (!settingKey) return false;
    const value = await this.settings.get(settingKey as SettingKey);
    return !!value;
  }

  /** Throw if provider key is not registered. */
  private requireKnownProvider(key: string): void {
    const provider = this.registry.resolve(key);
    if (!provider) {
      throw new BadRequestException(`Unknown provider: ${key}`);
    }
  }
}
