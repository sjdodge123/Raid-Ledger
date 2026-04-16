import { MAX_RESPONSE_CHARS } from '../ai-chat.constants';

/** Format a leaf response from LLM summary text. */
export function formatLeafResponse(text: string): string {
  if (!text || text.trim().length === 0) return 'No summary available.';
  const trimmed = text.trim();
  if (trimmed.length <= MAX_RESPONSE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_RESPONSE_CHARS - 3) + '...';
}

/** Format raw fallback when LLM is unavailable. */
export function formatRawFallback(data: string): string {
  if (!data || data.trim().length === 0) return 'No data available.';
  const trimmed = data.trim();
  if (trimmed.length <= MAX_RESPONSE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_RESPONSE_CHARS - 3) + '...';
}

/** Format an error message for the user. */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `Something went wrong: ${error.message}`;
  }
  return 'Something went wrong. Please try again.';
}

/** Format a static empty-state message. */
export function formatStaticEmpty(message: string): string {
  return message;
}
