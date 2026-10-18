/**
 * ROK-1839: capture the join flow's `?token=` and strip it from the address
 * bar at module load. main.tsx AND sentry.ts import this module ahead of
 * `@sentry/react`, so `window.location.href` no longer carries the token when
 * Sentry.init runs and Session Replay records its rrweb Meta event (the one
 * href no `beforeAddRecordingEvent` hook can reach). Keep the import list to
 * `./query-token` alone (a test pins it): anything that pulled in Sentry would
 * defeat this.
 *
 * Reload behaviour (operator default, ROK-1839): the token is mirrored into
 * `sessionStorage` under `rl.join_token` for the CURRENT TAB, so a reload of
 * the now-token-less URL still finds it. It is cleared the moment it has been
 * used (a successful redeem, or the hand-off into the Discord OAuth hop) and
 * on logout, and it dies with the tab by nature. It is never written to
 * localStorage, so it cannot outlive the session or reach another tab.
 */
import { readQueryToken, stripQueryToken } from './query-token';

/** sessionStorage key — tab-scoped, cleared on use and on logout. */
export const QUERY_TOKEN_STORAGE_KEY = 'rl.join_token';

/** sessionStorage throws in some privacy modes; a missing token is survivable. */
function readStored(): string | null {
    try {
        return window.sessionStorage.getItem(QUERY_TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeStored(token: string): void {
    try {
        window.sessionStorage.setItem(QUERY_TOKEN_STORAGE_KEY, token);
    } catch {
        /* the in-memory copy still serves this page load */
    }
}

function captureFromUrl(): string | null {
    const token = readQueryToken(window.location);
    // No token in the URL: this may be the reload AFTER a strip, so fall back
    // to whatever this tab captured earlier.
    if (token === null) return readStored();
    window.history.replaceState(null, '', stripQueryToken(window.location));
    writeStored(token);
    return token;
}

let captured: string | null = captureFromUrl();

/** The token this tab captured, if it has not been used yet. */
export function peekCapturedQueryToken(): string | null {
    return captured;
}

/** Drop the token once it has been redeemed or handed off, and on logout. */
export function clearCapturedQueryToken(): void {
    captured = null;
    try {
        window.sessionStorage.removeItem(QUERY_TOKEN_STORAGE_KEY);
    } catch {
        /* already gone as far as this tab is concerned */
    }
}
