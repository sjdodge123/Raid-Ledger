/**
 * Sentry initialization for the React frontend.
 * MUST be imported FIRST in main.tsx — before any other imports.
 * ROK-306: Maintainer telemetry — hardcoded DSN, opt-out via VITE_DISABLE_TELEMETRY.
 */
import * as Sentry from '@sentry/react';

const SENTRY_DSN =
    'https://b2e88c0a60c12e6cd5fbe3fd3ee2d974@o4510887305019392.ingest.us.sentry.io/4510887378747392';

const isProduction = import.meta.env.PROD;
const telemetryDisabled = import.meta.env.VITE_DISABLE_TELEMETRY === 'true';

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
    });
}

export { Sentry };
