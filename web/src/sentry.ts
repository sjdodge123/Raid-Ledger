/**
 * Sentry initialization for the React frontend.
 * MUST be imported FIRST in main.tsx — before any other imports.
 * ROK-306: Maintainer telemetry — hardcoded DSN, opt-out via VITE_DISABLE_TELEMETRY.
 */
import * as Sentry from '@sentry/react';
import { scrubBreadcrumb, scrubTokenFromUrl } from './lib/sentry-scrub';
import {
    scrubRecordingEvent,
    scrubReplayEventUrls,
    scrubTransactionEvent,
} from './lib/sentry-scrub-events';

const SENTRY_DSN =
    'https://54d787fd4c3d48bc77a750b5e3f76bd5@o4510887305019392.ingest.us.sentry.io/4510887344799744';

const isProduction = import.meta.env.PROD;
const telemetryDisabled = import.meta.env.VITE_DISABLE_TELEMETRY === 'true';
const isLocalhost = ['localhost', '127.0.0.1'].includes(
    window.location.hostname,
);

// Track transport-level send failures (e.g. 403 from invalid DSN)
let _lastTransportFailed = false;

if (!telemetryDisabled) {
    Sentry.init({
        dsn: SENTRY_DSN,
        enabled: !isLocalhost,
        environment: isProduction ? 'production' : 'development',
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: isProduction ? 1.0 : 0,
        // ROK-1366: the navigation PerformanceEntry keeps the pre-strip URL
        // (fragment included) — scrub it from spans, replay and replay urls.
        beforeSendTransaction: (event) => scrubTransactionEvent(event),
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({ beforeAddRecordingEvent: scrubRecordingEvent }),
            { name: 'ScrubReplayUrls', processEvent: scrubReplayEventUrls },
        ],
        // ROK-1162: drop AbortError noise (TanStack Query cancels in-flight
        // fetches on unmount / refetch; the cancellation surfaces as
        // AbortError or DOMException and is not a bug).
        beforeSend(event) {
            const exceptionType = event.exception?.values?.[0]?.type;
            const exceptionValue = event.exception?.values?.[0]?.value;
            if (
                exceptionType === 'AbortError' ||
                (exceptionType === 'DOMException' &&
                    typeof exceptionValue === 'string' &&
                    /abort/i.test(exceptionValue))
            ) {
                return null;
            }
            // ROK-1366 backstop: scrub a `token=` from the error event's
            // request.url. This covers request.url only. The join page's
            // intent `?token=` stays in the address bar, so it still reaches
            // the Replay Meta href (TECH-DEBT-BACKLOG.md, 2026-09-27).
            if (event.request?.url) {
                event.request.url = scrubTokenFromUrl(event.request.url);
            }
            return event;
        },
        beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
        initialScope: {
            tags: {
                app_version: (window as unknown as { __APP_VERSION__?: string })
                    .__APP_VERSION__ ?? 'unknown',
                deployment: window.location.hostname,
            },
        },
        transport: (options) => {
            const base = Sentry.makeFetchTransport(options);
            return {
                send: async (envelope) => {
                    const result = await base.send(envelope);
                    if (result.statusCode !== undefined && result.statusCode >= 400) {
                        _lastTransportFailed = true;
                    }
                    return result;
                },
                flush: (timeout) => base.flush(timeout),
            };
        },
    });
}

/**
 * Send a Sentry message and verify delivery succeeded.
 * Returns true if the event was accepted, false if delivery failed or telemetry is disabled.
 */
export async function captureMessageVerified(
    message: string,
    context: Sentry.CaptureContext,
): Promise<boolean> {
    if (telemetryDisabled) return false;

    _lastTransportFailed = false;
    Sentry.captureMessage(message, context);
    await Sentry.flush(3000);
    return !_lastTransportFailed;
}

export { Sentry };
