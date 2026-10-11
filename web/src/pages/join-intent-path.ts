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
 */
export function joinIntentPath(d: StoredJoinIntent): string {
    const params = new URLSearchParams({
        intent: d.intent ?? '',
        eventId: d.eventId ?? '',
        token: d.token ?? '',
    });
    return `/join?${params.toString()}`;
}
