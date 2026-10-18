/**
 * ROK-1839: pure helpers for the query-string sign-in token (`?token=`).
 *
 * The magic-link flow carries its token in the fragment (`lib/magic-link.ts`).
 * The join flow (Discord "Join & Sign Up", PUG invite, poll link) carries an
 * intent token in the QUERY STRING instead, and a query string DOES reach
 * `window.location.href` — which is where Sentry's Session Replay builds the
 * rrweb Meta (type 4) event's `href` inside the SDK. Replay only passes custom
 * (type 5) events to `beforeAddRecordingEvent`, so no hook of ours can scrub
 * that Meta href; the token has to be gone from the address bar before Sentry
 * initialises. These helpers do the reading and the rewriting; the capture at
 * module load lives in `query-token-capture.ts`.
 *
 * This module imports nothing, so it can never evaluate Sentry ahead of the
 * strip (pinned by `query-token-capture.test.ts`).
 */

interface UrlParts {
    pathname: string;
    search: string;
    hash: string;
}

/** The query parameter the join flow ships its single-use intent token in. */
export const QUERY_TOKEN_PARAM = 'token';

/** Read a sign-in token from a location's query string. */
export function readQueryToken(location: { search: string }): string | null {
    return new URLSearchParams(location.search).get(QUERY_TOKEN_PARAM);
}

/**
 * Build the cleaned-up URL for a location whose query string carried a token.
 * Path and fragment are kept verbatim, every other query param keeps its place
 * and value; only `token` goes.
 */
export function stripQueryToken(location: UrlParts): string {
    const params = new URLSearchParams(location.search);
    if (!params.has(QUERY_TOKEN_PARAM)) return location.pathname + location.search + location.hash;
    params.delete(QUERY_TOKEN_PARAM);
    const rest = params.toString();
    return location.pathname + (rest ? `?${rest}` : '') + location.hash;
}
