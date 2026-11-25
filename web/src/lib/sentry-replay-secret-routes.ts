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
 * So the whole segment is dropped instead, and so is the rest of that replay
 * (see `taintedReplayIds`). A segment's `urls` hold the address at its last
 * checkout plus every navigation since, and the current address covers a
 * segment flushed while still on the page. Only replays that reached these
 * routes are lost; everything else records exactly as before.
 */
import { scrubReplayEventUrls } from './sentry-scrub-events';

/**
 * Path prefixes whose address carries a secret. Case-insensitive because
 * React Router matches routes case-insensitively, so `/P/POLL/<t>` renders.
 */
const SECRET_ROUTE = /^\/(?:p\/poll\/|h\/|i\/|auth\/success\/*$)/i;

/** Any base works: only the pathname of a relative URL is read. */
const PARSE_BASE = 'https://replay.invalid';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Decode a pathname the way React Router does before it matches routes: each
 * segment is percent-decoded and a decoded `/` stays `%2F`, so `/%68/<t>`
 * becomes `/h/<t>`. Throws on a malformed escape (`URIError`).
 */
function decodePathLikeRouter(pathname: string): string {
    return pathname
        .split('/')
        .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
        .join('/');
}

/**
 * Whether a URL (absolute or path-relative) is on a secret-address route,
 * matched against the router-decoded path. An unparseable URL or a malformed
 * percent-encoding counts as secret: dropping a replay is the safe failure.
 */
export function isSecretRouteUrl(url: string): boolean {
    try {
        // Repeated slashes are collapsed first so `//h/<t>` and `/auth//success` still match (fail closed).
        const path = decodePathLikeRouter(new URL(url, PARSE_BASE).pathname);
        return SECRET_ROUTE.test(path.replace(/\/{2,}/g, '/'));
    } catch {
        return true;
    }
}

/**
 * Replay ids that ever touched a secret route in this page. `urls` alone is not
 * enough: after an error is sampled on a secret route the SDK flushes (clearing
 * `urls`), then restarts recording under the SAME replay id with a fresh Meta
 * snapshot of the secret href and no `urls` entry for it (`resume()` after an
 * idle pause does the same). Every SDK path that starts a recording WITHOUT
 * that restart (`_initializeRecording`, a session refresh, a buffer checkout)
 * pushes its href to `urls`, and navigations push theirs. So the first
 * segment of a replay that could hold a secret href is always caught by
 * `urls` or the current address, and segments flush in order: tainting its
 * id there drops every later segment of that recording too.
 */
const taintedReplayIds = new Set<string>();

function touchesSecretRoute(event: Record<string, unknown>, currentHref: string): boolean {
    const urls = Array.isArray(event.urls) ? event.urls : [];
    const touched = urls.some((url: unknown) => typeof url === 'string' && isSecretRouteUrl(url));
    return touched || isSecretRouteUrl(currentHref);
}

/**
 * Drop a `replay_event` that touched a secret-address route (by its `urls` or
 * the current address), and every later segment of the same replay. A segment
 * without a replay id cannot be tracked, so it is dropped (fail closed). Every
 * other event passes through untouched.
 */
export function dropReplayOnSecretRoutes<T>(event: T, currentHref: string): T | null {
    if (!isRecord(event) || event.type !== 'replay_event') return event;
    const replayId = event.replay_id;
    if (typeof replayId !== 'string') return null;
    if (taintedReplayIds.has(replayId)) return null;
    if (!touchesSecretRoute(event, currentHref)) return event;
    taintedReplayIds.add(replayId);
    return null;
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
