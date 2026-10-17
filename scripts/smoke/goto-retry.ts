/**
 * Transport-only retry for Playwright navigations — TDB:1040.
 *
 * WHY: on the rl-infra fleet the browser reaches `slot-N.gamernight.net`
 * through the Cloudflare edge, and a single dropped connect there surfaces as
 * `page.goto: net::ERR_CONNECTION_RESET` (or `ERR_TIMED_OUT`, ...) in
 * whichever spec happened to be navigating. It reads as a product failure and
 * passes on the next run with no code change — the navigation twin of the
 * node-side `fetch failed` that ./fetch-retry.ts absorbs.
 *
 * SCOPE — deliberately narrow:
 *   * ONLY a Chromium `net::ERR_*` transport error retries. An HTTP response of
 *     any status resolves normally and is never retried.
 *   * A Playwright `TimeoutError` never retries: a genuinely hung page would
 *     otherwise double every navigation's budget and turn a slow failure into
 *     a test-level timeout that names nothing.
 *   * `net::ERR_ABORTED` never retries — it means another navigation
 *     superseded this one, which is the page's behaviour, not the network's.
 *   * ONE extra attempt, then the second error is rethrown unchanged.
 *
 * The short pause before the retry is not a `sleep()`-style test wait: nothing
 * about any assertion depends on it. An immediate re-connect after a dropped
 * one usually drops again; the edge needs a moment. Bounded and only ever
 * reached after a transport failure.
 */

/** Pause before the single retry. */
const RETRY_DELAY_MS = 500;

/**
 * Is this a navigation transport failure worth one more attempt?
 *
 * @param err - The value `page.goto` rejected with.
 * @returns true for a `net::ERR_*` error other than `ERR_ABORTED`.
 */
export function isNavigationTransportError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === 'TimeoutError') return false;
    const match = /net::(ERR_[A-Z_]+)/.exec(err.message);
    return !!match && match[1] !== 'ERR_ABORTED';
}

/**
 * Run a navigation, retrying ONCE on a `net::ERR_*` transport error.
 *
 * @param goto - The bound, un-wrapped `page.goto`.
 * @param url - Navigation target.
 * @param options - Passed through unchanged to both attempts.
 * @returns Whatever `goto` resolves with (an HTTP error response included).
 */
export async function gotoWithRetry<O, R>(
    goto: (url: string, options?: O) => Promise<R>,
    url: string,
    options?: O,
): Promise<R> {
    try {
        return await goto(url, options);
    } catch (err) {
        if (!isNavigationTransportError(err)) throw err;
        console.warn(
            `[goto-retry] ${url}: ${(err as Error).message.split('\n')[0]} — retrying once in ${RETRY_DELAY_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return goto(url, options);
    }
}
