/**
 * Lazy Session Replay for the web Sentry client (Sentry v11 upgrade).
 *
 * Replay is most of the Sentry vendor weight and only matters once an error
 * is sampled, so `src/sentry.ts` initialises Sentry without it and imports
 * this module dynamically after init. `vite.manual-chunks.ts` keeps
 * `@sentry/replay*` out of the eager `sentry` vendor chunk so this import is a
 * real lazy chunk. Sentry's own `lazyLoadIntegration` is not used: it injects
 * a script from Sentry's CDN, which the `script-src 'self'` CSP blocks.
 */
import { addIntegration, replayIntegration } from '@sentry/react';
import { scrubRecordingEvent } from './sentry-scrub-events';
import { guardFeedHrefs } from './sentry-replay-privacy';

/**
 * The Replay integration with its privacy options, or null when the feed-href
 * guard cannot be installed (ROK-1599: no Replay beats a leaked bearer URL).
 * `block` is left at the SDK default so `[data-sentry-block]` stays honoured.
 */
export function buildReplayIntegration(): ReturnType<typeof replayIntegration> | null {
    // ROK-1779: masking is explicit rather than an SDK default.
    const replay = replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        beforeAddRecordingEvent: scrubRecordingEvent,
    });
    return guardFeedHrefs(replay) ? replay : null;
}

/** Adds Replay to the running client with the options it had in `Sentry.init`. */
export function addReplayIntegration(): void {
    const replay = buildReplayIntegration();
    if (replay) addIntegration(replay);
}
