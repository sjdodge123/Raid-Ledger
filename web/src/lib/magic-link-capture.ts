/**
 * ROK-1366: capture the magic-link fragment token and strip it from the
 * address bar at module load. main.tsx AND sentry.ts import this module
 * FIRST, so the token is gone before Sentry hooks history for breadcrumbs,
 * tracing and replay (sentry.ts's own import survives any chunk split). Keep the import list to `./magic-link`
 * alone (a test pins it): anything that pulled in Sentry would defeat this.
 *
 * The value lives only in this module's memory until App takes it, once.
 *
 * ROK-2283: on `/signin-link` the token is still stripped here, but it is NOT
 * handed to App's auto-redeem — the tap-to-continue page holds it until the
 * member taps Continue, so opening the link in the wrong browser spends nothing.
 */
import { takeMagicLinkToken } from './magic-link';

/** The tap-to-continue landing for `/login` links (api `SIGNIN_LINK_PATH`). */
export const SIGNIN_LINK_PAGE_PATH = '/signin-link';

function isSigninLinkPage(pathname: string): boolean {
    return pathname.replace(/\/+$/, '') === SIGNIN_LINK_PAGE_PATH;
}

const token: string | null = takeMagicLinkToken(window);
const heldForTap = isSigninLinkPage(window.location.pathname);

let captured: string | null = heldForTap ? null : token;
let signinCaptured: string | null = heldForTap ? token : null;

/** Hand over the captured token once; every later call returns null. */
export function takeCapturedMagicLinkToken(): string | null {
    const value = captured;
    captured = null;
    return value;
}

/** The `/signin-link` token, unspent, until {@link clearCapturedSigninLinkToken}. */
export function peekCapturedSigninLinkToken(): string | null {
    return signinCaptured;
}

/** Drop the `/signin-link` token from memory (the page calls it on Continue). */
export function clearCapturedSigninLinkToken(): void {
    signinCaptured = null;
}
