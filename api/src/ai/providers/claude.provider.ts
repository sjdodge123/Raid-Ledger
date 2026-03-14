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
  fetchClaude,
  extractSystemPrompt,
  mapClaudeChatResponse,
  CLAUDE_MODELS,
} from './claude.helpers';
import type { ClaudeChatRaw } from './claude.helpers';

/**
 * Claude (Anthropic) LLM provider — cloud-hosted inference.
 */
@Injectable()
export class ClaudeProvider implements LlmProvider {
  readonly key = 'claude';
  readonly displayName = 'Claude (Anthropic)';
  readonly requiresApiKey = true;
  readonly selfHosted = false;

  constructor(private readonly settings: SettingsService) {}

  /** Resolve the Claude API key from settings. */
  private async getApiKey(): Promise<string | null> {
    return this.settings.get(AI_SETTING_KEYS.CLAUDE_API_KEY as SettingKey);
  }

  /** Check if the Anthropic API is reachable with a valid key. */
  async isAvailable(): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) return false;
      await fetchClaude(apiKey, '/v1/messages', {
        model: CLOUD_DEFAULTS.claude,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Return the hardcoded list of Claude models. */
  listModels(): Promise<LlmModelInfo[]> {
    return Promise.resolve(CLAUDE_MODELS);
  }

  /** Send a chat completion request to the Anthropic Messages API. */
  async chat(options: LlmChatOptions): Promise<LlmChatResponse> {
    const apiKey = await this.requireApiKey();
    const model = options.model ?? CLOUD_DEFAULTS.claude;
    const { systemPrompt, conversationMessages } = extractSystemPrompt(
      options.messages,
    );
    const start = Date.now();
    const body: Record<string, unknown> = {
      model,
      messages: conversationMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options.maxTokens ?? 1024,
    };
    if (systemPrompt) body.system = systemPrompt;
    const raw = await fetchClaude<ClaudeChatRaw>(apiKey, '/v1/messages', body);
    return mapClaudeChatResponse(raw, Date.now() - start);
  }

  /** Send a text generation request via the messages endpoint. */
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
    if (!apiKey) throw new Error('Claude API key not configured');
    return apiKey;
  }
}
