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
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';
import type { SettingKey } from '../../drizzle/schema';
import {
  fetchOllama,
  mapOllamaModel,
  mapOllamaChatResponse,
  mapOllamaGenerateResponse,
} from './ollama.helpers';
import type {
  OllamaRawModel,
  OllamaChatRaw,
  OllamaGenerateRaw,
} from './ollama.helpers';

/**
 * Ollama LLM provider — self-hosted inference.
 * Communicates with a local Ollama instance via REST API.
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly key = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly requiresApiKey = false;
  readonly selfHosted = true;

  constructor(private readonly settings: SettingsService) {}

  /** Resolve the Ollama base URL from settings or use default. */
  private async getBaseUrl(): Promise<string> {
    const url = await this.settings.get(
      AI_SETTING_KEYS.OLLAMA_URL as SettingKey,
    );
    return url || AI_DEFAULTS.ollamaUrl;
  }

  /** Check if Ollama is reachable AND has at least one model. */
  async isAvailable(): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl();
      const data = await fetchOllama<{ models: OllamaRawModel[] }>(
        baseUrl,
        '/api/tags',
        { timeoutMs: 5_000 },
      );
      return (data.models ?? []).length > 0;
    } catch {
      return false;
    }
  }

  /** List models available on the Ollama instance. */
  async listModels(): Promise<LlmModelInfo[]> {
    const baseUrl = await this.getBaseUrl();
    const data = await fetchOllama<{ models: OllamaRawModel[] }>(
      baseUrl,
      '/api/tags',
    );
    return (data.models ?? []).map(mapOllamaModel);
  }

  /** Send a chat completion request to Ollama. */
  async chat(options: LlmChatOptions): Promise<LlmChatResponse> {
    const baseUrl = await this.getBaseUrl();
    const model = options.model ?? AI_DEFAULTS.model;
    const start = Date.now();
    const raw = await fetchOllama<OllamaChatRaw>(baseUrl, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: false,
        options: { num_predict: options.maxTokens },
      }),
      timeoutMs: AI_DEFAULTS.timeoutMs,
    });
    return mapOllamaChatResponse(raw, Date.now() - start);
  }

  /** Send a text generation request to Ollama. */
  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse> {
    const baseUrl = await this.getBaseUrl();
    const model = options.model ?? AI_DEFAULTS.model;
    const start = Date.now();
    const raw = await fetchOllama<OllamaGenerateRaw>(baseUrl, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: options.prompt,
        stream: false,
        options: { num_predict: options.maxTokens },
      }),
      timeoutMs: AI_DEFAULTS.timeoutMs,
    });
    return mapOllamaGenerateResponse(raw, Date.now() - start);
  }
}
