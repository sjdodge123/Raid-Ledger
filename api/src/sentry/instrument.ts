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

if (!telemetryDisabled && isProduction) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: 'production',
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    beforeSend(event) {
      const exceptionType = event.exception?.values?.[0]?.type;
      const exceptionValue = event.exception?.values?.[0]?.value;
      // Don't report rate-limit (ThrottlerException) events to Sentry
      if (exceptionType === 'ThrottlerException') {
        return null;
      }
      // Don't report transient Discord OAuth failures (ROK-668)
      if (exceptionType === 'InternalOAuthError') {
        return null;
      }
      // Don't report intentional 503s emitted by community-insights panels
      // before the daily snapshot cron has run (ROK-1143). The endpoints are
      // doing the right thing operationally — the dashboard renders an empty
      // state — but the 503 status used to spam Sentry → GitHub on every
      // pre-cron page-view.
      if (
        typeof exceptionValue === 'string' &&
        exceptionValue.includes('no_snapshot_yet')
      ) {
        return null;
      }
      // ROK-1260: defense-in-depth — drop DiscordAPIError 50278/50007
      // events. The primary fix is in the processor (it catches these
      // before Sentry's auto-instrumentation), but if anything ever
      // re-throws them this filter ensures the noise can't come back.
      if (
        exceptionType === 'DiscordAPIError' &&
        typeof exceptionValue === 'string' &&
        /code 50278|code 50007|no mutual guilds|Cannot send messages to this user/.test(
          exceptionValue,
        )
      ) {
        return null;
      }
      // ROK-1162: drop ConflictException from applyStatusUpdate race detection.
      // NestJS surfaces ConflictException as HttpException 409; the 409 is
      // already in HTTP access logs, and the race is correct behavior
      // (ROK-1118), not a bug.
      if (
        exceptionType === 'HttpException' &&
        typeof exceptionValue === 'string' &&
        /status changed concurrently/.test(exceptionValue)
      ) {
        return null;
      }
      // ROK-1162: drop AbortError from cancelled fetches / IGDB stream
      // cancellation. These are intentional client-side or stream-cleanup
      // aborts, never a bug.
      if (
        exceptionType === 'AbortError' ||
        (exceptionType === 'DOMException' &&
          typeof exceptionValue === 'string' &&
          /abort/i.test(exceptionValue))
      ) {
        return null;
      }
      // ROK-1162: fingerprint discord.js transient/network failures so
      // they collapse into one inbox issue instead of N. discord.js v14
      // retries internally; what reaches Sentry is retry exhaustion —
      // worth visibility, but grouped.
      if (
        exceptionType === 'DiscordAPIError' &&
        typeof exceptionValue === 'string' &&
        /5\d\d|ECONNRESET|ETIMEDOUT|getaddrinfo|fetch failed|network/i.test(
          exceptionValue,
        )
      ) {
        event.fingerprint = ['discord-api-transient'];
      }
      return event;
    },
    // Filter out pg_catalog type introspection queries from the Postgres driver.
    // These are normal driver behavior (OID-to-JS type mapping) and trigger
    // false-positive N+1 detections in Sentry.
    ignoreSpans: [/pg_catalog/],
    initialScope: {
      tags: {
        deployment: os.hostname(),
      },
    },
  });
}
