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

/** Adds Replay to the running client with the options it had in `Sentry.init`. */
export function addReplayIntegration(): void {
    addIntegration(replayIntegration({ beforeAddRecordingEvent: scrubRecordingEvent }));
}
