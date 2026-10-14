/**
 * Sentry initialization for the React frontend.
 * MUST be imported FIRST in main.tsx — before any other imports.
 * ROK-306: Maintainer telemetry — hardcoded DSN, opt-out via VITE_DISABLE_TELEMETRY.
 *
 * ROK-1366: the magic-link fragment strip is this module's FIRST import. ES
 * module evaluation runs an importer's dependencies before its body, so the
 * token leaves the address bar before `Sentry.init` below — whichever chunk
 * the bundler puts this file in (main.tsx's import order alone did not survive
 * chunking). magic-link-capture.test.ts pins it.
 */
import './lib/magic-link-capture';
import * as Sentry from '@sentry/react';
import { scrubBreadcrumb } from './lib/sentry-scrub';
import {
    scrubErrorEvent,
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

const replaysSessionSampleRate = 0;
const replaysOnErrorSampleRate = isProduction ? 1.0 : 0;

/** Sentry v11's documented equivalent of the v10 `sendDefaultPii: false` default. */
const PII_KEY_DENY = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] };
const V10_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: PII_KEY_DENY, response: PII_KEY_DENY },
    httpBodies: [],
    urlQueryParams: PII_KEY_DENY,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
} satisfies Sentry.BrowserOptions['dataCollection'];

if (!telemetryDisabled) {
    Sentry.init({
        dsn: SENTRY_DSN,
        enabled: !isLocalhost,
        environment: isProduction ? 'production' : 'development',
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        replaysSessionSampleRate,
        replaysOnErrorSampleRate,
        // Sentry v11 streams spans by default, which turns
        // beforeSendTransaction into a no-op and would skip the ROK-1366
        // scrub below. Keep the v10 transaction model until it moves to
        // beforeSendSpan.
        traceLifecycle: 'static',
        // v11 dropped sendDefaultPii; pin the v10 data-collection baseline.
        dataCollection: V10_DATA_COLLECTION,
        // v11 defaults this to true; keep v10 issue grouping.
        attachStacktrace: false,
        // ROK-1366: the navigation PerformanceEntry keeps the pre-strip URL
        // (fragment included) — scrub it from spans, replay and replay urls.
        beforeSendTransaction: (event) => scrubTransactionEvent(event),
        integrations: [
            Sentry.browserTracingIntegration(),
            // Replay is added lazily below (lib/sentry-replay.ts).
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
            // ROK-1366 backstop + ROK-1750: scrub a `token=` / poll share
            // token from the error event's request.url, transaction name and
            // trace data. The join page's intent `?token=` stays in the
            // address bar, so it still reaches the Replay Meta href
            // (TECH-DEBT-BACKLOG.md, 2026-09-27).
            return scrubErrorEvent(event);
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
    // Replay loads in its own chunk after init, and not at all when no replay
    // would ever be sampled.
    if (replaysSessionSampleRate > 0 || replaysOnErrorSampleRate > 0) {
        void import('./lib/sentry-replay').then((m) => m.addReplayIntegration());
    }
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
