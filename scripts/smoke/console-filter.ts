/**
 * Shared "is this console error a real application fault?" filter.
 *
 * Extracted from `navigation.smoke.spec.ts` and `admin-discord.smoke.spec.ts`,
 * which each carried their own copy of the allowlist and had already drifted
 * (navigation knew about the ROK-1286 navigation-race noise; admin-discord did
 * not). One list, one place to reason about what is genuinely benign.
 *
 * The allowlist is deliberately made of specific, well-understood strings. A
 * real runtime fault — an uncaught TypeError, a failed render, a CSP violation
 * for anything the app actually loads — is NOT matched and still fails the test.
 */

/**
 * Substrings that mark a console error as environmental rather than an
 * application fault.
 *
 * ROK-1286: rapid `goto`/click navigation tears down in-flight `fetch`/query
 * requests and re-lays-out the shell mid-flight, emitting `AbortError` and
 * `ResizeObserver loop` noise that is not an application fault.
 */
const BENIGN_PATTERNS: readonly string[] = [
    'net::',
    'favicon',
    '404',
    '429',
    'CORS',
    'ERR_CONNECTION_REFUSED',
    'Failed to load resource',
    'AbortError',
    'aborted',
    'ResizeObserver',
];

/**
 * Cloudflare's Real User Monitoring beacon, injected into every response on a
 * PUBLIC host (ROK-1466: the fleet suite targets https://slot-N.gamernight.net,
 * which sits behind Cloudflare). The app's CSP does not allow that origin, so
 * the browser reports a violation on every page load — an artefact of the
 * proxy, never present on localhost or in GitHub CI, and nothing the app can
 * fix without weakening its own CSP.
 *
 * Matching is on the Cloudflare sources ONLY, so every other CSP violation —
 * including an inline-script or third-party-script report — stays fatal.
 */
const CLOUDFLARE_BEACON_SOURCES: readonly string[] = [
    'cloudflareinsights.com',
    'beacon.min.js',
];

export { CLOUDFLARE_BEACON_SOURCES };

export { BENIGN_PATTERNS };

/**
 * Reduce captured console errors to the ones that indicate a real fault.
 *
 * @param errors - Raw `console` error texts captured during the test.
 * @returns Only the errors worth failing on.
 */
export function filterBenignErrors(errors: string[]): string[] {
    return errors.filter(
        (e) =>
            !BENIGN_PATTERNS.some((p) => e.includes(p)) &&
            !CLOUDFLARE_BEACON_SOURCES.some((p) => e.includes(p)),
    );
}
