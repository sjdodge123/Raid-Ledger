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
  fetchGemini,
  mapGeminiMessages,
  mapGeminiModel,
  mapGeminiChatResponse,
} from './google.helpers';
import type { GeminiRawModel, GeminiChatRaw } from './google.helpers';

/**
 * Google Gemini LLM provider — cloud-hosted inference via Gemini API.
 */
@Injectable()
export class GoogleProvider implements LlmProvider {
  readonly key = 'google';
  readonly displayName = 'Google (Gemini)';
  readonly requiresApiKey = true;
  readonly selfHosted = false;
  readonly defaultModel = CLOUD_DEFAULTS.google;

  constructor(private readonly settings: SettingsService) {}

  /** Resolve the Google API key from settings. */
  private async getApiKey(): Promise<string | null> {
    return this.settings.get(AI_SETTING_KEYS.GOOGLE_API_KEY as SettingKey);
  }

  /** Check if the Gemini API is reachable with a valid key. */
  async isAvailable(): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) return false;
      await fetchGemini(apiKey, '/v1beta/models');
      return true;
    } catch {
      return false;
    }
  }

  /** List models available from Google that support generateContent. */
  async listModels(): Promise<LlmModelInfo[]> {
    const apiKey = await this.requireApiKey();
    const data = await fetchGemini<{ models: GeminiRawModel[] }>(
      apiKey,
      '/v1beta/models',
    );
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map(mapGeminiModel);
  }

  /** Send a generateContent request to the Gemini API. */
  async chat(options: LlmChatOptions): Promise<LlmChatResponse> {
    const apiKey = await this.requireApiKey();
    const model = options.model ?? CLOUD_DEFAULTS.google;
    const { contents, systemInstruction } = mapGeminiMessages(options.messages);
    const start = Date.now();
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    const raw = await fetchGemini<GeminiChatRaw>(
      apiKey,
      `/v1beta/models/${model}:generateContent`,
      body,
    );
    return mapGeminiChatResponse(raw, Date.now() - start);
  }

  /** Send a text generation request via generateContent. */
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
    if (!apiKey) throw new Error('Google API key not configured');
    return apiKey;
  }
}
