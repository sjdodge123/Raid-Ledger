import type { LlmChatMessage, LlmChatOptions } from './llm-provider.interface';

/**
 * Prepend the base system prompt to the message list if not already present.
 */
export function prepareMessages(
  messages: LlmChatMessage[],
  basePrompt: string,
): LlmChatMessage[] {
  const hasSystem = messages.some((m) => m.role === 'system');
  if (hasSystem) return messages;
  return [{ role: 'system', content: basePrompt }, ...messages];
}

/**
 * Enforce a token cap on the request options (mutates in place).
 */
export function enforceTokenCap(
  options: LlmChatOptions,
  maxTokens: number,
): void {
  if (!options.maxTokens || options.maxTokens > maxTokens) {
    options.maxTokens = maxTokens;
  }
}

/**
 * Execute an async function with a timeout.
 * @throws Error if the function exceeds the timeout.
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('LLM request timed out')),
      timeoutMs,
    );
    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
