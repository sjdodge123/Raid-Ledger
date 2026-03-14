import type {
  LlmModelInfo,
  LlmChatResponse,
  LlmGenerateResponse,
} from '../llm-provider.interface';

/** Raw model shape returned by the Ollama /api/tags endpoint. */
export interface OllamaRawModel {
  name: string;
  model: string;
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

/** Raw response from the Ollama /api/chat endpoint. */
export interface OllamaChatRaw {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Raw response from the Ollama /api/generate endpoint. */
export interface OllamaGenerateRaw {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Fetch helper for Ollama API calls with timeout support.
 * @throws Error on non-OK responses or timeouts.
 */
export async function fetchOllama<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 5_000, ...fetchOptions } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw Ollama model to the provider-agnostic LlmModelInfo. */
export function mapOllamaModel(raw: OllamaRawModel): LlmModelInfo {
  return {
    id: raw.name,
    name: raw.name,
    provider: 'ollama',
    capabilities: raw.details?.family ? [raw.details.family] : undefined,
  };
}

/** Map a raw Ollama chat response to LlmChatResponse. */
export function mapOllamaChatResponse(
  raw: OllamaChatRaw,
  latencyMs: number,
): LlmChatResponse {
  return {
    content: raw.message?.content ?? '',
    usage:
      raw.prompt_eval_count != null || raw.eval_count != null
        ? {
            promptTokens: raw.prompt_eval_count ?? 0,
            completionTokens: raw.eval_count ?? 0,
          }
        : undefined,
    latencyMs,
  };
}

/** Map a raw Ollama generate response to LlmGenerateResponse. */
export function mapOllamaGenerateResponse(
  raw: OllamaGenerateRaw,
  latencyMs: number,
): LlmGenerateResponse {
  return {
    content: raw.response ?? '',
    usage:
      raw.prompt_eval_count != null || raw.eval_count != null
        ? {
            promptTokens: raw.prompt_eval_count ?? 0,
            completionTokens: raw.eval_count ?? 0,
          }
        : undefined,
    latencyMs,
  };
}
