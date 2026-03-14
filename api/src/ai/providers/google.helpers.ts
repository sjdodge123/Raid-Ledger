import type {
  LlmModelInfo,
  LlmChatMessage,
  LlmChatResponse,
} from '../llm-provider.interface';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

/** Raw model from the Gemini list models endpoint. */
export interface GeminiRawModel {
  name: string;
  displayName: string;
  supportedGenerationMethods: string[];
}

/** Raw response from the Gemini generateContent endpoint. */
export interface GeminiChatRaw {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/** Gemini content format. */
interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

/** Result of mapping messages to Gemini format. */
interface GeminiMappedMessages {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
}

/**
 * Fetch helper for Gemini API calls with API key in query param.
 * @throws Error on non-OK responses.
 */
export async function fetchGemini<T>(
  apiKey: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${GEMINI_BASE}${path}${separator}key=${apiKey}`;
  const options: RequestInit = {
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.method = 'POST';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${path}: HTTP ${res.status} — ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * Convert LLM messages to Gemini contents format.
 * Extracts system messages into the systemInstruction field.
 */
export function mapGeminiMessages(
  messages: LlmChatMessage[],
): GeminiMappedMessages {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const convMsgs = messages.filter((m) => m.role !== 'system');
  const contents = convMsgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));
  const systemInstruction =
    systemMsgs.length > 0
      ? { parts: [{ text: systemMsgs.map((m) => m.content).join('\n') }] }
      : undefined;
  return { contents, systemInstruction };
}

/** Map a raw Gemini model to the provider-agnostic LlmModelInfo. */
export function mapGeminiModel(raw: GeminiRawModel): LlmModelInfo {
  return {
    id: raw.name.replace(/^models\//, ''),
    name: raw.displayName,
    provider: 'google',
  };
}

/** Map a raw Gemini generateContent response to LlmChatResponse. */
export function mapGeminiChatResponse(
  raw: GeminiChatRaw,
  latencyMs: number,
): LlmChatResponse {
  const content = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const usage = raw.usageMetadata
    ? {
        promptTokens: raw.usageMetadata.promptTokenCount ?? 0,
        completionTokens: raw.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;
  return { content, usage, latencyMs };
}
