/**
 * Sentry initialization for the React frontend.
 * ROK-306: Maintainer telemetry — hardcoded DSN (lib/sentry-options.ts).
 * ROK-1779: runtime opt-out. Nothing initialises at import time any more;
 * main.tsx fetches /system/status and calls `initSentry(telemetryEnabled)`.
 * VITE_DISABLE_TELEMETRY=true still disables it at build time. Until init
 * runs (or when it never does) every Sentry call below is a no-op.
 *
 * ROK-1366: the magic-link fragment strip is this module's FIRST import. ES
 * module evaluation runs an importer's dependencies before its body, so the
 * token leaves the address bar before `Sentry.init` — whichever chunk the
 * bundler puts this file in (main.tsx's import order alone did not survive
 * chunking). magic-link-capture.test.ts pins it.
 */
import './lib/magic-link-capture';
import * as Sentry from '@sentry/react';
import { buildSentryOptions, replaySampleRates } from './lib/sentry-options';
import { shouldInitTelemetry } from './lib/telemetry-gate';
import {
    bufferCapture,
    closeBootBuffer,
    installBootErrorBuffer,
    type PendingCapture,
} from './lib/sentry-boot-buffer';

// ROK-1779: errors thrown before the telemetry decision are held, then sent
// after init (ON) or dropped (OFF) — see lib/sentry-boot-buffer.ts.
installBootErrorBuffer();

let initialised = false;
let decided = false;
// Track transport-level send failures (e.g. 403 from invalid DSN)
let _lastTransportFailed = false;

/** Replay loads in its own chunk after init, and not at all when no replay would ever be sampled. */
function loadReplayLazily(): void {
    const rates = replaySampleRates();
    if (rates.session <= 0 && rates.onError <= 0) return;
    // A failed chunk load must not surface as an unhandled rejection that
    // Sentry itself would report; Replay is best-effort.
    void import('./lib/sentry-replay')
        .then((m) => m.addReplayIntegration())
        .catch((err: unknown) => {
            console.debug('[sentry] Replay chunk failed to load', err);
        });
}

/**
 * ROK-1779: initialise Sentry when the served flag allows it. Idempotent —
 * a second call returns the first call's result without re-initialising.
 * Returns whether telemetry is active.
 */
export function initSentry(serverEnabled: boolean | undefined): boolean {
    if (decided) return initialised;
    decided = true;
    const buildDisabled = import.meta.env.VITE_DISABLE_TELEMETRY === 'true';
    if (!shouldInitTelemetry(serverEnabled, buildDisabled)) {
        closeBootBuffer(); // OFF: the held startup errors are dropped unsent
        return false;
    }
    initialised = true;
    Sentry.init(buildSentryOptions(() => { _lastTransportFailed = true; }));
    closeBootBuffer().forEach(sendPending);
    loadReplayLazily();
    return true;
}

/** Send one startup error held while the decision was pending. */
function sendPending({ error, source, componentStack }: PendingCapture): void {
    Sentry.captureException(error, {
        tags: { 'boot.buffered': source },
        ...(componentStack === undefined ? {} : { contexts: { react: { componentStack } } }),
    });
}

/**
 * ROK-1779: React 19 root error hooks (main.tsx). Held while the decision is
 * pending, forwarded once telemetry is ON, dropped when OFF.
 */
export function captureReactError(
    error: unknown,
    { componentStack }: { componentStack?: string | undefined },
): void {
    const stack = componentStack === undefined ? {} : { componentStack };
    if (bufferCapture({ error, source: 'react-root', ...stack })) return;
    if (initialised) Sentry.reactErrorHandler()(error, stack);
}

/**
 * ROK-1779: Sentry.ErrorBoundary `onError`. The boundary reports by itself
 * once Sentry is live; before the decision there is no client, so hold it.
 */
export function bufferBoundaryError(error: unknown, componentStack: string): void {
    bufferCapture({ error, source: 'error-boundary', componentStack });
}

/**
 * ROK-1779: main.tsx boot glue — load /system/status, then decide. A failed
 * load means no init (fail closed). Resolves to whether telemetry is active.
 */
export function bootTelemetry(
    loadStatus: () => Promise<{ telemetryEnabled?: boolean | undefined }>,
): Promise<boolean> {
    return loadStatus().then(
        (s) => initSentry(s.telemetryEnabled),
        () => initSentry(undefined),
    );
}

/** Whether `initSentry` has initialised the client. */
export function isTelemetryActive(): boolean {
    return initialised;
}

/**
 * Send a Sentry message and verify delivery succeeded.
 * Returns false only when an initialised client failed to deliver. When
 * telemetry is off (opted out, or not yet initialised) it sends nothing and
 * returns true: the caller's own record (e.g. the saved feedback row) is
 * the delivery, and an opted-out instance must not show a Sentry error.
 */
export async function captureMessageVerified(
    message: string,
    context: Sentry.CaptureContext,
): Promise<boolean> {
    if (!initialised) return true;

    _lastTransportFailed = false;
    Sentry.captureMessage(message, context);
    await Sentry.flush(3000);
    return !_lastTransportFailed;
}

export { Sentry };
