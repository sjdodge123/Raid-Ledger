/**
 * Back-off policy for `POST /auth/local` from the smoke harness (ROK-1466).
 *
 * On the fleet the suite reaches the env over its internal hostname, with no
 * Cloudflare hop in front, so every worker's login lands on the API's own
 * rate limiter within milliseconds of the others. The previous policy — three
 * attempts at a flat 5s then 15s, ignoring `Retry-After` — gave up inside the
 * limiter's window and surfaced as `Auth failed after 3 attempts (rate
 * limited)` on every co-op spec in the file.
 *
 * The fix is to wait as long as the server asks. Loosening the limiter is not
 * an option: it is a production security control that DEMO_MODE does not
 * disable, and a smoke suite that only passes with it relaxed is not testing
 * the deployed configuration.
 */

/**
 * Attempts before giving up.
 *
 * Reviewer nit: `loginViaApi` runs INSIDE a Playwright test, whose timeout is
 * 30s (CI) / 60s (local). A budget longer than that means the give-up message
 * is unreachable — the test dies first with a timeout that names nothing. Four
 * attempts inside MAX_TOTAL_WAIT_MS keeps the real error reachable.
 */
export const MAX_LOGIN_ATTEMPTS = 4;

/** Total time this policy may spend sleeping across all attempts. */
export const MAX_TOTAL_WAIT_MS = 25_000;

/**
 * Cap on OUR OWN backoff guesswork. It deliberately does NOT bound a server
 * `Retry-After`: the server is the only party that knows when the window
 * reopens, so its hint is honoured verbatim and affordability is decided by
 * `nextDelayMs` against the total budget.
 */
export const MAX_DELAY_MS = 15_000;

/** Never spin faster than this, however small/absent the hint. */
export const MIN_DELAY_MS = 1_000;

/** Base for the exponential fallback when the server sends no hint. */
const BASE_DELAY_MS = 2_000;

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * Both RFC 9110 forms are accepted: delta-seconds (`30`) and an HTTP-date
 * (`Wed, 02 Sep 2026 18:30:00 GMT`).
 *
 * @param header - Raw header value, or null when absent.
 * @returns Milliseconds to wait, or null when the header is absent/unparsable.
 */
export function parseRetryAfter(header: string | null): number | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed) * 1000;
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return null;
    return at - Date.now();
}

/**
 * How long to wait before the next login attempt.
 *
 * A server-supplied `Retry-After` always wins — it is the only value that
 * actually knows when the window reopens. Absent one, back off exponentially.
 * Both paths are clamped to [MIN_DELAY_MS, MAX_DELAY_MS] so a hostile or
 * garbage header can neither hang the run nor turn it into a hot loop.
 *
 * @param attempt - Zero-based attempt index that just failed.
 * @param retryAfter - The response's `Retry-After` header, if any.
 * @returns Milliseconds to sleep.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
    const hinted = parseRetryAfter(retryAfter);
    // A hint is honoured verbatim (floored, so a zero/negative header cannot
    // become a hot loop). Clamping it here would mean retrying BEFORE the
    // window reopens — guaranteed to 429 again. Whether we can AFFORD the wait
    // is nextDelayMs's decision, not this one's.
    if (hinted !== null) return Math.max(MIN_DELAY_MS, hinted);
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
}

/**
 * The delay to actually sleep, or null when the retry budget is spent.
 *
 * Wraps `retryDelayMs` with the total-wait cap so the caller stops and throws
 * its own diagnostic instead of being killed by Playwright's test timeout
 * mid-sleep — a failure that names the test rather than the rate limiter.
 *
 * A wait that does not fit the remaining budget is refused outright rather
 * than shortened. Sleeping a stub of it and retrying anyway lands before the
 * window reopens: another 429, one attempt burned, and the limiter hit early —
 * strictly worse than giving up and reporting what the server asked for.
 *
 * @param attempt - Zero-based attempt index that just failed.
 * @param retryAfter - The response's `Retry-After` header, if any.
 * @param elapsedMs - Time already spent sleeping in this login.
 * @returns Milliseconds to sleep, or null to give up now.
 */
export function nextDelayMs(
    attempt: number,
    retryAfter: string | null,
    elapsedMs: number,
): number | null {
    const remaining = MAX_TOTAL_WAIT_MS - elapsedMs;
    if (remaining <= 0) return null;
    const delay = retryDelayMs(attempt, retryAfter);
    return delay > remaining ? null : delay;
}
