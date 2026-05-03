import {
  Controller,
  Get,
  Logger,
  Post,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugins/plugin-host/plugin-active.guard';
import { LlmService } from './llm.service';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import { SettingsService } from '../settings/settings.service';
import { AI_DEFAULTS, AI_SETTING_KEYS, CLOUD_DEFAULTS } from './llm.constants';
import {
  buildStatusResponse,
  buildUsageResponse,
  deriveAvailability,
} from './ai-admin.helpers';
import type {
  AiStatusDto,
  AiTestConnectionDto,
  AiUsageDto,
} from '@raid-ledger/contract';
import type { AiModelDto } from '@raid-ledger/contract';

/**
 * Admin endpoints for AI plugin status, models, and usage.
 */
@Controller('admin/ai')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin('ai')
export class AiAdminController {
  private readonly logger = new Logger(AiAdminController.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly registry: LlmProviderRegistry,
    private readonly logService: AiRequestLogService,
    private readonly settings: SettingsService,
  ) {}

  /** GET /admin/ai/status — provider connectivity and current model. */
  @Get('status')
  async getStatus(): Promise<AiStatusDto> {
    const resolution = await this.registry.resolveActive();
    const provider = resolution?.provider;
    const isAvailable = await this.resolveAvailability(provider?.key ?? null);
    const modelSetting = await this.settings.get(AI_SETTING_KEYS.MODEL);
    const model = this.resolveDisplayModel(provider?.key, modelSetting);
    return buildStatusResponse(provider, model, isAvailable);
  }

  /** GET /admin/ai/models — list models from the active provider. */
  @Get('models')
  async getModels(): Promise<AiModelDto[]> {
    const models = await this.withTimeout(this.llmService.listModels(), []);
    return models.map((m) => ({
      id: m.id,
      name: m.name,
      family: m.capabilities?.[0],
    }));
  }

  /** POST /admin/ai/test-connection — test provider connectivity. */
  @Post('test-connection')
  async testConnection(): Promise<AiTestConnectionDto> {
    const start = Date.now();
    const resolution = await this.registry.resolveActive();
    const available = await this.resolveAvailability(
      resolution?.provider?.key ?? null,
    );
    const latencyMs = Date.now() - start;
    return {
      success: available,
      message: available
        ? `Connected successfully (${latencyMs}ms)`
        : 'Failed to connect to AI provider',
      latencyMs,
    };
  }

  /** GET /admin/ai/usage — usage statistics from the DB. */
  @Get('usage')
  async getUsage(): Promise<AiUsageDto> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const stats = await this.logService.getUsageStats(thirtyDaysAgo);
    return buildUsageResponse(stats);
  }

  /** Resolve display model: cloud providers use CLOUD_DEFAULTS, Ollama uses setting. */
  private resolveDisplayModel(
    providerKey: string | undefined,
    modelSetting: string | null,
  ): string {
    if (providerKey && providerKey in CLOUD_DEFAULTS) {
      return CLOUD_DEFAULTS[providerKey as keyof typeof CLOUD_DEFAULTS];
    }
    return modelSetting ?? AI_DEFAULTS.model;
  }

  /**
   * Heartbeat-first availability check (ROK-1138). If a successful chat ran
   * within `AI_DEFAULTS.availabilityFreshnessMs` we skip the live probe;
   * otherwise fall back to the existing timeout-wrapped probe.
   */
  private async resolveAvailability(
    providerKey: string | null,
  ): Promise<boolean> {
    const lastSuccessAt = providerKey
      ? await this.logService.getLastSuccessfulChatAt(providerKey)
      : null;
    return deriveAvailability({
      providerKey,
      lastSuccessAt,
      probe: () => this.withTimeout(this.llmService.isAvailable(), false),
      now: new Date(),
      freshnessMs: AI_DEFAULTS.availabilityFreshnessMs,
    });
  }

  /** Race a promise against a 3s timeout, returning fallback on timeout/error. */
  private async withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    try {
      return await Promise.race([
        promise,
        new Promise<T>((r) => setTimeout(() => r(fallback), 3000)),
      ]);
    } catch {
      return fallback;
    }
  }

  /** GET /admin/ai/features — read AI feature toggle states. */
  @Get('features')
  async getFeatures(): Promise<{
    chatEnabled: boolean;
    dynamicCategoriesEnabled: boolean;
    aiSuggestionsEnabled: boolean;
  }> {
    const chat = await this.settings.get(AI_SETTING_KEYS.CHAT_ENABLED);
    const dynCat = await this.settings.get(
      AI_SETTING_KEYS.DYNAMIC_CATEGORIES_ENABLED,
    );
    const sugg = await this.settings.get(AI_SETTING_KEYS.SUGGESTIONS_ENABLED);
    return {
      chatEnabled: chat === 'true',
      dynamicCategoriesEnabled: dynCat === 'true',
      // ROK-1114: defaults to true so an unconfigured install gets the
      // feature; admin must explicitly set 'false' to disable.
      aiSuggestionsEnabled: sugg !== 'false',
    };
  }

  /** PUT /admin/ai/features — update AI feature toggles. */
  @Put('features')
  @HttpCode(HttpStatus.OK)
  async updateFeatures(
    @Body()
    body: {
      chatEnabled?: boolean;
      dynamicCategoriesEnabled?: boolean;
      aiSuggestionsEnabled?: boolean;
    },
  ): Promise<{ success: boolean }> {
    if (body.chatEnabled !== undefined) {
      await this.settings.set(
        AI_SETTING_KEYS.CHAT_ENABLED,
        String(body.chatEnabled),
      );
    }
    if (body.dynamicCategoriesEnabled !== undefined) {
      await this.settings.set(
        AI_SETTING_KEYS.DYNAMIC_CATEGORIES_ENABLED,
        String(body.dynamicCategoriesEnabled),
      );
    }
    if (body.aiSuggestionsEnabled !== undefined) {
      await this.settings.set(
        AI_SETTING_KEYS.SUGGESTIONS_ENABLED,
        String(body.aiSuggestionsEnabled),
      );
    }
    return { success: true };
  }

  /** POST /admin/ai/test-chat — send a test message to the active LLM. */
  @Post('test-chat')
  async testChat(): Promise<{
    success: boolean;
    response: string;
    latencyMs: number;
  }> {
    const isUp = await this.withTimeout(this.llmService.isAvailable(), false);
    if (!isUp) return this.notAvailableResult();
    const resolution = await this.registry.resolveActive();
    const provider = resolution?.provider;
    const modelSetting = await this.settings.get(AI_SETTING_KEYS.MODEL);
    const model = this.resolveDisplayModel(provider?.key, modelSetting);
    const start = Date.now();
    this.logger.log(
      `test-chat start | provider=${provider?.key} model=${model}`,
    );
    try {
      const result = await this.llmService.chat(
        { messages: [{ role: 'user', content: 'Say hello in one sentence.' }] },
        {
          feature: 'admin-test',
          maxResponseLength: 200,
          timeoutMs: AI_DEFAULTS.maxTimeoutMs,
        },
      );
      this.logger.log(`test-chat ok | latency=${result.latencyMs}ms`);
      return {
        success: true,
        response: result.content,
        latencyMs: result.latencyMs,
      };
    } catch (e) {
      return this.buildTestChatError(e, start, provider?.key, model);
    }
  }

  private notAvailableResult() {
    return {
      success: false,
      response:
        'No AI provider is currently available. Start or configure a provider first.',
      latencyMs: 0,
    };
  }

  /** Build a diagnostic error response for test-chat failures. */
  private buildTestChatError(
    e: unknown,
    start: number,
    providerKey?: string,
    model?: string | null,
  ) {
    const elapsed = Date.now() - start;
    const msg = e instanceof Error ? e.message : 'Unknown error';
    this.logger.warn(`test-chat failed | elapsed=${elapsed}ms error=${msg}`);
    const detail = `${msg} — provider: ${providerKey ?? 'unknown'}, model: ${model ?? 'unknown'}, elapsed: ${elapsed}ms`;
    return { success: false, response: detail, latencyMs: elapsed };
  }
}
