/**
 * Sentry instrumentation for the NestJS backend.
 * MUST be imported FIRST in main.ts — before any other imports.
 * ROK-306: Maintainer telemetry — hardcoded DSN, opt-out via DISABLE_TELEMETRY.
 */
import * as Sentry from '@sentry/nestjs';
import * as os from 'os';

const SENTRY_DSN =
  'https://54d787fd4c3d48bc77a750b5e3f76bd5@o4510887305019392.ingest.us.sentry.io/4510887344799744';

const isProduction = process.env.NODE_ENV === 'production';
const telemetryDisabled = process.env.DISABLE_TELEMETRY === 'true';

if (!telemetryDisabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: isProduction ? 'production' : 'development',
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    beforeSend(event) {
      // Don't report rate-limit (ThrottlerException) events to Sentry
      const exceptionType = event.exception?.values?.[0]?.type;
      if (exceptionType === 'ThrottlerException') {
        return null;
      }
      return event;
    },
    initialScope: {
      tags: {
        deployment: os.hostname(),
      },
    },
  });
}
