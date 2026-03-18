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
import { OllamaNativeService } from './providers/ollama-native.service';
import { OllamaSetupService } from './providers/ollama-setup.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from './llm.constants';
import type {
  AiProviderInfoDto,
  AiOllamaSetupDto,
  AiProviderConfigDto,
} from '@raid-ledger/contract';
import { getApiKeySettingKey, buildProviderInfo } from './ai-providers.helpers';
import type { SettingKey } from '../drizzle/schema';

/**
 * Admin endpoints for managing AI providers.
 */
@Controller('admin/ai/providers')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin('ai')
export class AiProvidersController {
  private readonly logger = new Logger(AiProvidersController.name);

  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly settings: SettingsService,
    private readonly docker: OllamaDockerService,
    private readonly native: OllamaNativeService,
    private readonly ollamaSetup: OllamaSetupService,
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
    @Body() body: AiProviderConfigDto,
  ): Promise<{ success: boolean }> {
    this.requireKnownProvider(key);
    if (!body.apiKey && !body.url && !body.model) {
      throw new BadRequestException(
        'At least one of apiKey, url, or model is required',
      );
    }
    await this.saveProviderConfig(key, body);
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
  async setupOllama(): Promise<AiOllamaSetupDto> {
    return this.ollamaSetup.startSetup();
  }

  /** POST /admin/ai/providers/ollama/stop — Stop Ollama (Docker or native). */
  @Post('ollama/stop')
  async stopOllama(): Promise<{ success: boolean }> {
    if (this.native.isAllinoneMode()) {
      await this.native.stopService();
    } else {
      await this.docker.stopContainer();
    }
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
    const { available, error } = configured
      ? await this.checkAvailableWithError(provider)
      : { available: false, error: undefined };
    const info = buildProviderInfo(
      provider as never,
      configured,
      available,
      provider.key === activeKey,
    );
    if (error) info.error = error;
    if (provider.key === 'ollama') {
      await this.enrichOllamaInfo(info);
    }
    return info;
  }

  /** Add Ollama-specific setup state from DB to provider info. */
  private async enrichOllamaInfo(info: AiProviderInfoDto): Promise<void> {
    const state = await this.ollamaSetup.getSetupState();
    info.setupInProgress = state.running;
    if (state.running) {
      info.setupStep = state.step;
    }
    if (state.step === 'error' && state.error) {
      info.error = state.error;
      info.setupStep = 'error';
    }
    if (!info.available && !state.running) {
      const exists = await this.hasExistingInstall();
      info.setupStep =
        info.setupStep || (exists ? 'container_exists' : undefined);
    }
  }

  /** Check whether an Ollama install exists (Docker container or native). */
  private async hasExistingInstall(): Promise<boolean> {
    if (this.native.isAllinoneMode()) {
      const status = await this.native.getServiceStatus();
      return status !== 'not-found';
    }
    const status = await this.docker.getContainerStatus();
    return status !== 'not-found';
  }

  /** Check availability with 3s timeout, capturing error details. */
  private async checkAvailableWithError(provider: {
    key: string;
    isAvailable: () => Promise<boolean>;
  }): Promise<{ available: boolean; error?: string }> {
    try {
      const available = await Promise.race([
        provider.isAvailable(),
        new Promise<false>((r) => setTimeout(() => r(false), 3000)),
      ]);
      return { available };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = this.extractFriendlyError(msg);
      return { available: false, error: friendly };
    }
  }

  private extractFriendlyError(msg: string): string {
    if (msg.includes('credit balance'))
      return 'Account has insufficient credits';
    if (msg.includes('insufficient_quota'))
      return 'Account has insufficient quota';
    if (msg.includes('billing')) return 'Billing issue — check your account';
    if (msg.includes('API_KEY_INVALID') || msg.includes('invalid'))
      return 'Invalid API key';
    if (msg.includes('authentication') || msg.includes('401'))
      return 'Invalid API key';
    if (msg.includes('403') || msg.includes('PERMISSION_DENIED'))
      return 'API key lacks permissions';
    if (msg.includes('429')) return 'Rate limited — try again later';
    return 'Provider unreachable';
  }

  /** Save individual config fields for a provider. */
  private async saveProviderConfig(
    key: string,
    body: AiProviderConfigDto,
  ): Promise<void> {
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
