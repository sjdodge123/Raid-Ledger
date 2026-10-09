/**
 * ROK-1592 (spec §4.1 error contract): the errors every calendar adapter
 * throws. Callers branch on the class, never on the message.
 *
 * Messages never carry tokens, codes, secrets or response bodies: a `reason`
 * is kept only when it looks like a short provider error code
 * (`invalid_grant`, `http_503`); anything else becomes `unspecified`. There is
 * no `cause` — a wrapped fetch error can hold a URL with a token in it.
 */
const SAFE_REASON = /^[a-z0-9_]{1,48}$/;

function safeReason(reason: string | undefined): string {
  return reason && SAFE_REASON.test(reason) ? reason : 'unspecified';
}

export type CalendarProviderErrorCode =
  'auth' | 'rate_limited' | 'transient' | 'not_found' | 'not_configured';

export abstract class CalendarProviderError extends Error {
  abstract readonly code: CalendarProviderErrorCode;
  /** The sanitised provider reason (`unspecified` when none was safe). */
  readonly reason: string;

  protected constructor(summary: string, reason?: string) {
    const safe = safeReason(reason);
    super(`${summary} (${safe})`);
    this.reason = safe;
    this.name = new.target.name;
  }
}

/** 401, `invalid_grant`, revoked token: mark `needs_reconnect`, no retry. */
export class ProviderAuthError extends CalendarProviderError {
  readonly code = 'auth' as const;
  constructor(reason?: string) {
    super('Calendar provider rejected the credentials', reason);
  }
}

/** 429 / `Retry-After`: retry no sooner than `retryAfterMs`. */
export class RateLimitError extends CalendarProviderError {
  readonly code = 'rate_limited' as const;
  constructor(
    readonly retryAfterMs: number,
    reason?: string,
  ) {
    super('Calendar provider rate limit', reason);
  }
}

/** 5xx, timeout, network failure: retry with backoff. */
export class TransientError extends CalendarProviderError {
  readonly code = 'transient' as const;
  constructor(reason?: string) {
    super('Calendar provider temporarily unavailable', reason);
  }
}

/** 404 / 410 on a provider object (deleteEvent treats it as success). */
export class NotFoundError extends CalendarProviderError {
  readonly code = 'not_found' as const;
  constructor(reason?: string) {
    super('Calendar provider object not found', reason);
  }
}

/** The admin has not entered this provider's client id + secret. */
export class ProviderNotConfiguredError extends CalendarProviderError {
  readonly code = 'not_configured' as const;
  constructor(reason?: string) {
    super('Calendar provider is not configured', reason);
  }
}
