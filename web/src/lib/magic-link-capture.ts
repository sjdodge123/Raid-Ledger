/**
 * ROK-1366: capture the magic-link fragment token and strip it from the
 * address bar at module load. main.tsx AND sentry.ts import this module
 * FIRST, so the token is gone before Sentry hooks history for breadcrumbs,
 * tracing and replay (sentry.ts's own import survives any chunk split). Keep the import list to `./magic-link`
 * alone (a test pins it): anything that pulled in Sentry would defeat this.
 *
 * The value lives only in this module's memory until App takes it, once.
 */
import { takeMagicLinkToken } from './magic-link';

let captured: string | null = takeMagicLinkToken(window);

/** Hand over the captured token once; every later call returns null. */
export function takeCapturedMagicLinkToken(): string | null {
    const token = captured;
    captured = null;
    return token;
}
