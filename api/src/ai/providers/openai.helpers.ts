import type { LlmModelInfo, LlmChatResponse } from '../llm-provider.interface';

/** Known OpenAI chat model IDs to filter against. */
export const OPENAI_CHAT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3-mini',
] as const;

/** Raw model entry from the OpenAI /v1/models endpoint. */
export interface OpenAiRawModel {
  id: string;
  object: string;
}

/** Raw chat completion response from OpenAI. */
export interface OpenAiChatRaw {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Fetch helper for OpenAI API calls with timeout support.
 * @throws Error on non-OK responses or timeouts.
 */
export async function fetchOpenAi<T>(
  apiKey: string,
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 5_000, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.openai.com${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...fetchOptions?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI ${path}: HTTP ${res.status} — ${body}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw OpenAI model to the provider-agnostic LlmModelInfo. */
export function mapOpenAiModel(raw: OpenAiRawModel): LlmModelInfo {
  return {
    id: raw.id,
    name: raw.id,
    provider: 'openai',
  };
}

/** Map a raw OpenAI chat response to LlmChatResponse. */
export function mapOpenAiChatResponse(
  raw: OpenAiChatRaw,
  latencyMs: number,
): LlmChatResponse {
  const content = raw.choices?.[0]?.message?.content ?? '';
  const usage = raw.usage
    ? {
        promptTokens: raw.usage.prompt_tokens ?? 0,
        completionTokens: raw.usage.completion_tokens ?? 0,
      }
    : undefined;
  return { content, usage, latencyMs };
}
