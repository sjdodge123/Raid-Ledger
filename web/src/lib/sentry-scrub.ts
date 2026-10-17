/**
 * ROK-1366 backstop: scrub any `token=` URL param (fragment or query) — and,
 * since ROK-1750, a poll share token in the path — before Sentry records it.
 * main.tsx strips the magic-link fragment before Sentry initialises; this
 * catches anything that still slips through.
 */

/**
 * Where a secret value ends (ROK-1838 r4). ONE character class with `+`:
 * linear, nothing nested for a pathological input to backtrack into.
 *
 * A value stops at whitespace, at the next query param (`&`, `#`), at a quote,
 * at `)`/`}` and at a comma. No credential this app issues or accepts (JWT,
 * base64url, hex, uuid, Discord/OAuth codes) contains any of those bytes, so a
 * comma can only belong to the log line or JSON object the value sits in —
 * which is why stopping there cannot cut a secret in half.
 *
 * `[` and `]` are deliberately INSIDE the class. That makes the literal
 * `[Filtered]` an ordinary value: replacing it with `[Filtered]` is a no-op, so
 * every matcher built on this pattern is idempotent, and a spoofed placeholder
 * with secret bytes glued on (`password=[Filtered]swordfish`) is replaced whole
 * instead of being skipped by a lookahead.
 */
export const SECRET_VALUE = String.raw`[^&#\s"'(){},]+`;

/** A `token=` param right after `#`, `?` or `&`. */
const TOKEN_PARAM = new RegExp(String.raw`([#?&]token=)` + SECRET_VALUE, 'g');

/**
 * ROK-1750: a private poll's share token is a PATH segment — the page
 * `/p/poll/<t>` and the API `/scheduling-polls/share/<t>` (+ `/join`). It is
 * a bearer credential (invitee access until reset), so it never reaches
 * Sentry either.
 */
const SHARE_TOKEN_PATH = /(\/(?:api\/)?(?:scheduling-polls\/share|p\/poll)\/)[A-Za-z0-9_-]{16,}/g;

/**
 * ROK-1838 r4: the ICS subscribe feed `/api/cal/u/<token>.ics` is the same
 * shape of credential — anyone holding the URL reads the owner's calendar
 * until they reset the feed. The `.ics` suffix is outside the match, so the
 * scrubbed URL still reads as a calendar feed.
 */
const FEED_TOKEN_PATH = /(\/(?:api\/)?cal\/u\/)[A-Za-z0-9_-]{16,}/g;

const FILTERED = '[Filtered]';

/** Breadcrumb `data` keys that carry a URL (navigation, fetch, xhr). */
const URL_KEYS = ['from', 'to', 'url'] as const;

export function scrubTokenFromUrl(url: string): string {
    return url
        .replace(TOKEN_PARAM, `$1${FILTERED}`)
        .replace(SHARE_TOKEN_PATH, `$1${FILTERED}`)
        .replace(FEED_TOKEN_PATH, `$1${FILTERED}`);
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
