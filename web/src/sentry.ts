/**
 * Sentry initialization for the React frontend.
 * MUST be imported FIRST in main.tsx — before any other imports.
 * ROK-306: Maintainer telemetry — hardcoded DSN, opt-out via VITE_DISABLE_TELEMETRY.
 */
import * as Sentry from '@sentry/react';

const SENTRY_DSN =
    'https://54d787fd4c3d48bc77a750b5e3f76bd5@o4510887305019392.ingest.us.sentry.io/4510887344799744';

const isProduction = import.meta.env.PROD;
const telemetryDisabled = import.meta.env.VITE_DISABLE_TELEMETRY === 'true';

// Track transport-level send failures (e.g. 403 from invalid DSN)
let _lastTransportFailed = false;

if (!telemetryDisabled) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: isProduction ? 'production' : 'development',
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: isProduction ? 1.0 : 0,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
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
