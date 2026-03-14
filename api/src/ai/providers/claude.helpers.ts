import type {
  LlmModelInfo,
  LlmChatMessage,
  LlmChatResponse,
} from '../llm-provider.interface';

/** Hardcoded list of available Claude models (Anthropic has no list API). */
export const CLAUDE_MODELS: LlmModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'claude',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
  },
];

/** Raw chat response from the Anthropic Messages API. */
export interface ClaudeChatRaw {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Result of extracting system prompt from messages. */
export interface ExtractedPrompt {
  systemPrompt: string | undefined;
  conversationMessages: LlmChatMessage[];
}

/**
 * Fetch helper for Anthropic API calls.
 * @throws Error on non-OK responses.
 */
export async function fetchClaude<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Separate system messages from the conversation messages.
 * Anthropic requires system prompt in a top-level field, not in messages.
 */
export function extractSystemPrompt(
  messages: LlmChatMessage[],
): ExtractedPrompt {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const conversationMessages = messages.filter((m) => m.role !== 'system');
  const systemPrompt =
    systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join('\n')
      : undefined;
  return { systemPrompt, conversationMessages };
}

/** Map a raw Anthropic chat response to LlmChatResponse. */
export function mapClaudeChatResponse(
  raw: ClaudeChatRaw,
  latencyMs: number,
): LlmChatResponse {
  const content = raw.content?.[0]?.text ?? '';
  const usage = raw.usage
    ? {
        promptTokens: raw.usage.input_tokens ?? 0,
        completionTokens: raw.usage.output_tokens ?? 0,
      }
    : undefined;
  return { content, usage, latencyMs };
}
