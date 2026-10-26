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

/** True for `/link` and its trailing-slash form `/link/`. */
function isLinkPath(pathname: string): boolean {
    return pathname === LINK_PATH || pathname === `${LINK_PATH}/`;
}

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
    if (!isLinkPath(pathname)) return null;
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

/** The captured code, without consuming it (null when none or already taken). */
export function peekCapturedLinkCode(): string | null {
    return captured;
}

/**
 * ROK-1955 review: the capture strips the code before the router mounts, so a
 * signed-out visitor's saved return path would be a bare `/link` — and Discord
 * sign-in is a full-page redirect that drops this module's state. Put the
 * still-unconsumed code back on a `/link` return path, in the FRAGMENT (never
 * a query), so `/link` pre-fills after sign-in. The return path lives only in
 * sessionStorage (`lib/auth-redirect`); it never travels to the server.
 * Any other path is returned unchanged.
 */
export function withCapturedLinkCode(path: string): string {
    const withoutHash = path.split('#')[0] ?? path;
    const pathname = withoutHash.split('?')[0] ?? withoutHash;
    if (captured === null || !isLinkPath(pathname)) return path;
    return `${withoutHash}#code=${encodeURIComponent(captured)}`;
}
