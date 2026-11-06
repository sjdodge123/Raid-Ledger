/**
 * Abuse guards for the public, unauthenticated POST /csp-report endpoint
 * (backlog 2026-10-18, csp-report.controller.ts:21). The route is rate
 * limited per IP only, so a handful of IPs could still exhaust the org's
 * Sentry quota and blind alerting (the ROK-1501 failure, on purpose).
 */

/** Max CSP reports sent to Sentry per window, across all clients. */
export const CSP_SENTRY_BUDGET_PER_WINDOW = 30;
export const CSP_SENTRY_BUDGET_WINDOW_MS = 60_000;
/** Max characters of a report body written to the app log. */
export const CSP_LOG_MAX_CHARS = 2048;

/** Fixed-window counter: at most `limit` captures per `windowMs`. */
export class CspSentryBudget {
  private windowStart = Number.NEGATIVE_INFINITY;
  private used = 0;

  constructor(
    private readonly limit: number = CSP_SENTRY_BUDGET_PER_WINDOW,
    private readonly windowMs: number = CSP_SENTRY_BUDGET_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one capture from the budget; false when the window is spent. */
  tryConsume(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}

/**
 * The report as it goes into the app log: unchanged when its JSON fits in
 * CSP_LOG_MAX_CHARS, otherwise the first CSP_LOG_MAX_CHARS characters of it.
 */
export function logSafeReport(
  report: unknown,
): { report: unknown } | { reportTruncated: string } {
  let json: string;
  try {
    json = JSON.stringify(report) ?? '';
  } catch {
    return { reportTruncated: '[unserialisable report]' };
  }
  if (json.length <= CSP_LOG_MAX_CHARS) return { report };
  return { reportTruncated: json.slice(0, CSP_LOG_MAX_CHARS) };
}
