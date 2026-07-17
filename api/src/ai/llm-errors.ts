/**
 * Typed LLM provider error classification (ROK-1376).
 *
 * Providers historically collapsed every non-OK response into a generic
 * `Error`, so callers could not tell a quota/spend-cap exhaustion
 * (retries CANNOT succeed until billing resets) from a transient 5xx
 * (retries may succeed). The AI-suggestions pre-gen processor branches
 * on this type to stop retry burns and arm a cooldown.
 */

/** Body substrings that signal quota/spend-cap exhaustion on any status. */
const QUOTA_BODY_PATTERNS = ['resource_exhausted', 'quota', 'spending cap'];

/**
 * True when a provider failure means quota/spend-cap exhaustion: HTTP
 * 429, a RESOURCE_EXHAUSTED status body, or quota / spending-cap message
 * text (the prod 2026-06-20 Gemini spend-cap shape).
 *
 * Deliberately broad (approved ROK-1376 tradeoff): a transient per-minute
 * RPM 429 also lands here and arms the full cooldown. Bounding the TTL by
 * Gemini's RetryInfo/retryDelay hint was rejected — Gemini reports short
 * retryDelay values even when the daily quota / spend cap won't reset for
 * hours, which would re-open the retry burn this classifier exists to
 * stop. Mitigations: stale rows still serve and the cooldown self-heals.
 */
export function isQuotaExhaustedSignal(status: number, body: string): boolean {
  if (status === 429) return true;
  const lower = body.toLowerCase();
  return QUOTA_BODY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * A provider request failed because the account/project is out of quota
 * (rate limit, monthly spend cap, RESOURCE_EXHAUSTED). Not retryable
 * until billing/quota resets — callers must not burn further attempts.
 */
export class LlmQuotaExhaustedError extends Error {
  readonly name = 'LlmQuotaExhaustedError';

  constructor(
    message: string,
    /** HTTP status the provider answered with (preserved for telemetry). */
    readonly providerStatus: number,
  ) {
    super(message);
  }
}
