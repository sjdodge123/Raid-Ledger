/**
 * ROK-1955 Codex P2: capture the companion device-link code (`/link#code=…`,
 * or a legacy `?code=`) and strip it from the address bar at MODULE LOAD.
 * `sentry.ts` imports this ahead of `@sentry/react`, so the code is gone from
 * `window.location.href` before `Sentry.init` runs and before Session Replay
 * records its rrweb Meta href (which no scrub hook can reach). The URL
 * scrubber (`sentry-scrub.ts`) is the backstop for anything later.
 *
 * This module imports nothing, so it can never evaluate Sentry first.
 */

/** The approval page path (mirrors the API's `COMPANION_LINK_PATH`). */
const LINK_PATH = '/link';

/** Remove `code` from a `?…` / `#…` part; '' when nothing else is left. */
function withoutCode(part: string, prefix: '?' | '#'): string {
    const params = new URLSearchParams(part.replace(/^[#?]/, ''));
    params.delete('code');
    const rest = params.toString();
    return rest === '' ? '' : `${prefix}${rest}`;
}

/** Read the code from the current URL and replace it out of history. */
function captureFromUrl(): string | null {
    const { pathname, search, hash } = window.location;
    if (pathname !== LINK_PATH) return null;
    const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('code');
    const code = fromHash || new URLSearchParams(search).get('code');
    if (!code) return null;
    const stripped = `${pathname}${withoutCode(search, '?')}${withoutCode(hash, '#')}`;
    window.history.replaceState(window.history.state, '', stripped);
    return code;
}

let captured: string | null = captureFromUrl();

/** The code captured at load, handed out once (the `/link` page pre-fills it). */
export function takeCapturedLinkCode(): string | null {
    const code = captured;
    captured = null;
    return code;
}
