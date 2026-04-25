import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import type {
  LlmProvider,
  LlmModelInfo,
  LlmChatOptions,
  LlmChatResponse,
  LlmGenerateOptions,
  LlmGenerateResponse,
} from '../llm-provider.interface';
import { AI_SETTING_KEYS, CLOUD_DEFAULTS } from '../llm.constants';
import type { SettingKey } from '../../drizzle/schema';
import {
  fetchOpenAi,
  mapOpenAiModel,
  mapOpenAiChatResponse,
  OPENAI_CHAT_MODELS,
} from './openai.helpers';
import type { OpenAiRawModel, OpenAiChatRaw } from './openai.helpers';

/**
 * OpenAI LLM provider — cloud-hosted inference via OpenAI API.
 */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly key = 'openai';
  readonly displayName = 'OpenAI';
  readonly requiresApiKey = true;
  readonly selfHosted = false;
  readonly defaultModel = CLOUD_DEFAULTS.openai;

  constructor(private readonly settings: SettingsService) {}

  /** Resolve the OpenAI API key from settings. */
  private async getApiKey(): Promise<string | null> {
    return this.settings.get(AI_SETTING_KEYS.OPENAI_API_KEY as SettingKey);
  }

  /** Check if OpenAI is reachable with a valid API key. */
  async isAvailable(): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) return false;
      await fetchOpenAi(apiKey, '/v1/models');
      return true;
    } catch {
      return false;
    }
  }

  /** List chat models available from OpenAI. */
  async listModels(): Promise<LlmModelInfo[]> {
    const apiKey = await this.requireApiKey();
    const data = await fetchOpenAi<{ data: OpenAiRawModel[] }>(
      apiKey,
      '/v1/models',
    );
    return (data.data ?? [])
      .filter((m) => OPENAI_CHAT_MODELS.includes(m.id as never))
      .map(mapOpenAiModel);
  }

  /** Send a chat completion request to OpenAI. */
  async chat(options: LlmChatOptions): Promise<LlmChatResponse> {
    const apiKey = await this.requireApiKey();
    const model = options.model ?? CLOUD_DEFAULTS.openai;
    const start = Date.now();
    const raw = await fetchOpenAi<OpenAiChatRaw>(
      apiKey,
      '/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        }),
      },
    );
    return mapOpenAiChatResponse(raw, Date.now() - start);
  }

  /** Send a text generation request via the chat endpoint. */
  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const result = await this.chat({
      messages: [{ role: 'user', content: options.prompt }],
      model: options.model,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
    return {
      content: result.content,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  }

  /** Get API key or throw if not configured. */
  private async requireApiKey(): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('OpenAI API key not configured');
    return apiKey;
  }
}
