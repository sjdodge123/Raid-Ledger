import { Controller, Get, Post, UseGuards } from '@nestjs/common';
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
import { AI_DEFAULTS, AI_SETTING_KEYS } from './llm.constants';
import { buildStatusResponse, buildUsageResponse } from './ai-admin.helpers';
import type {
  AiStatusDto,
  AiTestConnectionDto,
  AiUsageDto,
} from '@raid-ledger/contract';
import type { AiModelDto } from '@raid-ledger/contract';
import type { SettingKey } from '../drizzle/schema';

/**
 * Admin endpoints for AI plugin status, models, and usage.
 */
@Controller('admin/ai')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin('ai')
export class AiAdminController {
  constructor(
    private readonly llmService: LlmService,
    private readonly registry: LlmProviderRegistry,
    private readonly logService: AiRequestLogService,
    private readonly settings: SettingsService,
  ) {}

  /** GET /admin/ai/status — provider connectivity and current model. */
  @Get('status')
  async getStatus(): Promise<AiStatusDto> {
    const provider = await this.registry.resolveActive();
    const isAvailable = await this.withTimeout(
      this.llmService.isAvailable(),
      false,
    );
    const model = await this.settings.get(AI_SETTING_KEYS.MODEL as SettingKey);
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
    const available = await this.withTimeout(
      this.llmService.isAvailable(),
      false,
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

  /** POST /admin/ai/test-chat — send a test message to the active LLM. */
  @Post('test-chat')
  async testChat(): Promise<{
    success: boolean;
    response: string;
    latencyMs: number;
  }> {
    const isUp = await this.withTimeout(this.llmService.isAvailable(), false);
    if (!isUp) {
      return {
        success: false,
        response:
          'No AI provider is currently available. Start or configure a provider first.',
        latencyMs: 0,
      };
    }
    try {
      const result = await this.llmService.chat(
        { messages: [{ role: 'user', content: 'Say hello in one sentence.' }] },
        { feature: 'admin-test', maxResponseLength: 200, timeoutMs: AI_DEFAULTS.maxTimeoutMs },
      );
      return {
        success: true,
        response: result.content,
        latencyMs: result.latencyMs,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, response: msg, latencyMs: 0 };
    }
  }
}
