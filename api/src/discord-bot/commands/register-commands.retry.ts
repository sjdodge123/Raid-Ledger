/**
 * Retry policy for slash-command registration (ROK-2204).
 */

/** Registration attempts per CONNECTED event before giving up. */
export const REGISTER_MAX_ATTEMPTS = 3;

/** First retry delay; doubles per attempt (2s, then 4s). */
export const REGISTER_RETRY_BASE_MS = 2000;

/** Backoff before retry number `attempt` (1-based failed attempt). */
export function registerRetryDelayMs(attempt: number): number {
  return REGISTER_RETRY_BASE_MS * 2 ** (attempt - 1);
}

/** The HTTP status a discord.js REST error carries, if any. */
function restStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('status' in error) || typeof error.status !== 'number') return null;
  return error.status;
}

/**
 * True for a failure retrying cannot fix: a Discord REST 4xx (bad token,
 * missing access, invalid command body, unknown application). 408 and 429
 * are transient; network errors, timeouts and 5xx carry no 4xx status.
 * @param error - whatever the registration attempt threw
 */
export function isPermanentRegisterError(error: unknown): boolean {
  const status = restStatus(error);
  if (status === null || status < 400 || status >= 500) return false;
  return status !== 408 && status !== 429;
}
