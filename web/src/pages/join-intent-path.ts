/** The deferred-signup intent join-page.tsx stashes before the Discord round-trip. */
export interface StoredJoinIntent {
    intent: string | null;
    eventId: string | null;
    token: string | null;
}

/**
 * ROK-1757: rebuild the `/join?...` URL from the stored intent with
 * URLSearchParams, so a crafted value carrying `&`, `#` or `=` stays inside
 * its own param instead of injecting or overriding others.
 *
 * ROK-1839: the rebuilt path carries NO `token=`. The post-OAuth hop is a
 * client-side navigation, so the module-load strip in `lib/query-token-capture`
 * never re-runs and Sentry + Session Replay are already live — a token here
 * would land in a replay's rrweb Meta href. The caller hands the token to
 * `setCapturedQueryToken` instead, and /join reads it from there.
 */
export function joinIntentPath(d: StoredJoinIntent): string {
    const params = new URLSearchParams({
        intent: d.intent ?? '',
        eventId: d.eventId ?? '',
    });
    return `/join?${params.toString()}`;
}
