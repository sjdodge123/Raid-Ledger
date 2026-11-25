/**
 * TDB L3350: Session Replay segments are never sent for routes whose ADDRESS
 * is a secret.
 *
 * rrweb records the page address in its Meta event (`href`) at every full
 * snapshot, and Replay's `beforeAddRecordingEvent` only sees custom events, so
 * that href cannot be scrubbed. ROK-1839 fixed the join link by moving its
 * `?token=` out of the address bar before Sentry starts; these three cannot
 * move, because the secret IS the route:
 *
 * - `/p/poll/:token` — a private poll's share token (signed-out visitors stay
 *   on that page);
 * - `/h/:token` — a hub invite (ROK-1893), the same share token;
 * - `/i/:code` — a PUG invite code;
 * - `/auth/success?code=` — the OAuth one-time code.
 *
 * So the whole segment is dropped instead. A segment's `urls` hold the address
 * at its last checkout (the Meta href) plus every navigation since, and the
 * current address covers a segment flushed while still on the page. Only these
 * routes lose replay; everything else records exactly as before.
 */
import { scrubReplayEventUrls } from './sentry-scrub-events';

/**
 * Path prefixes whose address carries a secret. Case-insensitive because
 * React Router matches routes case-insensitively, so `/P/POLL/<t>` renders.
 */
const SECRET_ROUTE = /^\/(?:p\/poll\/|h\/|i\/|auth\/success\/?$)/i;

/** Any base works: only the pathname of a relative URL is read. */
const PARSE_BASE = 'https://replay.invalid';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Whether a URL (absolute or path-relative) is on a secret-address route.
 * An unparseable URL counts as secret: dropping a replay is the safe failure.
 */
export function isSecretRouteUrl(url: string): boolean {
    try {
        return SECRET_ROUTE.test(new URL(url, PARSE_BASE).pathname);
    } catch {
        return true;
    }
}

/**
 * Drop a `replay_event` that touched a secret-address route (by its `urls` or
 * the current address); every other event passes through untouched.
 */
export function dropReplayOnSecretRoutes<T>(event: T, currentHref: string): T | null {
    if (!isRecord(event) || event.type !== 'replay_event') return event;
    const urls = Array.isArray(event.urls) ? event.urls : [];
    const touched = urls.some((url: unknown) => typeof url === 'string' && isSecretRouteUrl(url));
    return touched || isSecretRouteUrl(currentHref) ? null : event;
}

/**
 * The `ScrubReplayUrls` integration's `processEvent`: drop a secret-route
 * replay segment, then scrub `token=` / share tokens from the `urls` of any
 * segment that is kept.
 */
export function processReplayEvent<T>(event: T): T | null {
    const kept = dropReplayOnSecretRoutes(event, window.location.href);
    return kept === null ? null : scrubReplayEventUrls(kept);
}
