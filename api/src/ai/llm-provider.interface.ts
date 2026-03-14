/** Message role in an LLM chat conversation. */
export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A single message in an LLM chat conversation. */
export interface LlmChatMessage {
  role: LlmMessageRole;
  content: string;
  toolCallId?: string;
}

/** JSON Schema definition for an LLM tool parameter. */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call requested by the LLM. */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Token usage information from an LLM response. */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Response from an LLM chat completion. */
export interface LlmChatResponse {
  content: string;
  toolCalls?: LlmToolCall[];
  usage?: LlmUsage;
  latencyMs: number;
}

/** Response from an LLM text generation. */
export interface LlmGenerateResponse {
  content: string;
  usage?: LlmUsage;
  latencyMs: number;
}

/** Metadata about an available LLM model. */
export interface LlmModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  capabilities?: string[];
}

/** Response format hint for structured output. */
export type LlmResponseFormat = 'text' | 'json';

/** Options for an LLM chat request. */
export interface LlmChatOptions {
  messages: LlmChatMessage[];
  model?: string;
  tools?: LlmToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: LlmResponseFormat;
}

/** Options for an LLM text generation request. */
export interface LlmGenerateOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: LlmResponseFormat;
}

/** Context metadata attached to every LLM request for logging. */
export interface LlmRequestContext {
  feature: string;
  userId?: number;
  maxResponseLength?: number;
}

/** Provider-agnostic interface for LLM backends. */
export interface LlmProvider {
  /** Unique key identifying this provider (e.g. 'ollama'). */
  readonly key: string;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Whether the provider requires an API key. */
  readonly requiresApiKey: boolean;
  /** Whether the provider is self-hosted. */
  readonly selfHosted: boolean;

  /** Check if the provider is reachable. */
  isAvailable(): Promise<boolean>;
  /** List models available from this provider. */
  listModels(): Promise<LlmModelInfo[]>;
  /** Send a chat completion request. */
  chat(options: LlmChatOptions): Promise<LlmChatResponse>;
  /** Send a text generation request. */
  generate(options: LlmGenerateOptions): Promise<LlmGenerateResponse>;
}
