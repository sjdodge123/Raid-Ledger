/**
 * ROK-1366 backstop: scrub any `token=` URL param (fragment or query) before
 * Sentry records it. main.tsx strips the magic-link fragment before Sentry
 * initialises; this catches anything that still slips through.
 */

/** A `token=` param right after `#`, `?` or `&`, up to the next `&` or `#`. */
const TOKEN_PARAM = /([#?&]token=)[^&#\s]*/g;

const FILTERED = '[Filtered]';

/** Breadcrumb `data` keys that carry a URL (navigation, fetch, xhr). */
const URL_KEYS = ['from', 'to', 'url'] as const;

export function scrubTokenFromUrl(url: string): string {
    return url.replace(TOKEN_PARAM, `$1${FILTERED}`);
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
