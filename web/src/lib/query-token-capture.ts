/**
 * ROK-1839: capture the join flow's `?token=` and strip it from the address
 * bar at module load. main.tsx AND sentry.ts import this module ahead of
 * `@sentry/react`, so `window.location.href` no longer carries the token when
 * Sentry.init runs and Session Replay records its rrweb Meta event (the one
 * href no `beforeAddRecordingEvent` hook can reach). Keep the import list to
 * `./query-token` alone (a test pins it): anything that pulled in Sentry would
 * defeat this.
 *
 * The capture is BOUND TO ITS PAGE — `{ token, eventId, intent }` read from
 * the same URL. /join only falls back to a capture taken for the event and
 * intent it is showing; one left over from an abandoned link is ignored and
 * cleared rather than redeemed against the wrong page.
 *
 * Reload behaviour (operator default, ROK-1839): the record is mirrored into
 * `sessionStorage` under `rl.join_token` for the CURRENT TAB, so a reload of
 * the now-token-less URL still finds it. It is cleared the moment the token
 * has been spent — a redeem that SUCCEEDED, was REJECTED or threw — at the
 * hand-off into the Discord OAuth hop, when the join page rules the link
 * invalid, when a capture does not belong to the page reading it, and on every
 * session end (logout, a rejected refresh, deactivation, an identity change in
 * this tab or another). It dies with the tab by nature, and is never written to
 * localStorage, so it cannot outlive the session or reach another tab.
 */
import { readQueryToken, stripQueryToken } from './query-token';

/** sessionStorage key — tab-scoped, cleared on use and on every session end. */
export const QUERY_TOKEN_STORAGE_KEY = 'rl.join_token';

/**
 * ROK-1839 fix round r2 (Opus M2 / Codex P3): `capturedAt` is enforced, not
 * decorative. 15 minutes matches the intent token's own server-side lifetime,
 * so a capture can never outlive the thing it unlocks: a tab left open on a
 * half-finished join flow stops being redeemable at the same moment the
 * server would reject it anyway. A record with no usable timestamp reads as
 * `capturedAt: 0` and is therefore already expired — a forged or legacy entry
 * is dropped rather than trusted.
 */
export const CAPTURE_TTL_MS = 15 * 60 * 1000;

/** A captured join token together with the page context it was taken from. */
export interface CapturedQueryToken {
    token: string;
    eventId: string | null;
    intent: string | null;
    capturedAt: number;
}

/** Tolerant reader: anything that is not a usable record reads as "none". */
function parseStored(raw: string | null): CapturedQueryToken | null {
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { token, eventId, intent, capturedAt } = parsed as Record<string, unknown>;
        if (typeof token !== 'string' || token === '') return null;
        return {
            token,
            eventId: typeof eventId === 'string' ? eventId : null,
            intent: typeof intent === 'string' ? intent : null,
            capturedAt: typeof capturedAt === 'number' ? capturedAt : 0,
        };
    } catch {
        return null;
    }
}

/** sessionStorage throws in some privacy modes; a missing token is survivable. */
function readStored(): CapturedQueryToken | null {
    try {
        return parseStored(window.sessionStorage.getItem(QUERY_TOKEN_STORAGE_KEY));
    } catch {
        return null;
    }
}

function writeStored(entry: CapturedQueryToken): void {
    try {
        window.sessionStorage.setItem(QUERY_TOKEN_STORAGE_KEY, JSON.stringify(entry));
    } catch {
        /* the in-memory copy still serves this page load */
    }
}

/** The `intent`/`eventId` a token arrived alongside — the capture's binding. */
function contextOf(search: string): Pick<CapturedQueryToken, 'eventId' | 'intent'> {
    const params = new URLSearchParams(search);
    return { eventId: params.get('eventId'), intent: params.get('intent') };
}

function captureFromUrl(): CapturedQueryToken | null {
    const token = readQueryToken(window.location);
    // No token in the URL: this may be the reload AFTER a strip, so fall back
    // to whatever this tab captured earlier.
    if (token === null) return readStored();
    const entry: CapturedQueryToken = {
        token, ...contextOf(window.location.search), capturedAt: Date.now(),
    };
    // Keep `history.state`: react-router keys its history entry off it, and
    // replacing it with null strips the router's own state from this entry.
    window.history.replaceState(window.history.state, '', stripQueryToken(window.location));
    writeStored(entry);
    return entry;
}

let captured: CapturedQueryToken | null = captureFromUrl();

function isExpired(entry: CapturedQueryToken): boolean {
    return Date.now() - entry.capturedAt >= CAPTURE_TTL_MS;
}

/**
 * The token this tab captured, with its page context, if not yet spent and
 * still inside its TTL. An expired capture is not merely ignored — it is
 * cleared here, so the stale secret leaves memory and sessionStorage on the
 * first read that notices it rather than waiting for the tab to close.
 */
export function peekCapturedQueryToken(): CapturedQueryToken | null {
    if (captured === null) return null;
    if (isExpired(captured)) {
        clearCapturedQueryToken();
        return null;
    }
    return captured;
}

/**
 * Hand a token to the capture WITHOUT routing it through the address bar.
 * The post-OAuth hop (auth-success-page) uses this instead of rebuilding
 * `/join?...&token=`: that navigation is client-side, so the module-load strip
 * never re-runs and Sentry + Session Replay are already recording.
 */
export function setCapturedQueryToken(entry: Omit<CapturedQueryToken, 'capturedAt'>): void {
    captured = { ...entry, capturedAt: Date.now() };
    writeStored(captured);
}

/** Drop the token once it is spent, abandoned, or the session has ended. */
export function clearCapturedQueryToken(): void {
    captured = null;
    try {
        window.sessionStorage.removeItem(QUERY_TOKEN_STORAGE_KEY);
    } catch {
        /* already gone as far as this tab is concerned */
    }
}
