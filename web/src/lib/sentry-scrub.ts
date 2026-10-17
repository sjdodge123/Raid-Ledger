/**
 * ROK-1366 backstop: scrub any `token=` URL param (fragment or query) — and,
 * since ROK-1750, a poll share token in the path — before Sentry records it. main.tsx strips the magic-link fragment before Sentry
 * initialises; this catches anything that still slips through.
 */

/**
 * A `token=` param right after `#`, `?` or `&`. The value ends at the next
 * `&`/`#`, at whitespace, or at the punctuation that closes it inside JSON —
 * ROK-1838 r3: stopping only at whitespace ate the rest of a captured log line
 * (`{"url":"/j?token=a","status":500}` lost `status`).
 */
const TOKEN_PARAM = /([#?&]token=)(?!\[Filtered\])[^&#\s"',}\])]{0,4096}/g;

/**
 * ROK-1750: a private poll's share token is a PATH segment — the page
 * `/p/poll/<t>` and the API `/scheduling-polls/share/<t>` (+ `/join`). It is
 * a bearer credential (invitee access until reset), so it never reaches
 * Sentry either.
 */
const SHARE_TOKEN_PATH = /(\/(?:api\/)?(?:scheduling-polls\/share|p\/poll)\/)[A-Za-z0-9_-]{16,}/g;

const FILTERED = '[Filtered]';

/** Breadcrumb `data` keys that carry a URL (navigation, fetch, xhr). */
const URL_KEYS = ['from', 'to', 'url'] as const;

export function scrubTokenFromUrl(url: string): string {
    return url
        .replace(TOKEN_PARAM, `$1${FILTERED}`)
        .replace(SHARE_TOKEN_PATH, `$1${FILTERED}`);
}

interface ScrubbableCrumb {
    message?: string;
    data?: Record<string, unknown>;
}

/** Scrub URL-bearing fields of a breadcrumb in place and return it. */
export function scrubBreadcrumb<T extends ScrubbableCrumb>(crumb: T): T {
    if (typeof crumb.message === 'string') {
        crumb.message = scrubTokenFromUrl(crumb.message);
    }
    const data = crumb.data;
    if (!data) return crumb;
    for (const key of URL_KEYS) {
        const value = data[key];
        if (typeof value === 'string') data[key] = scrubTokenFromUrl(value);
    }
    return crumb;
}
