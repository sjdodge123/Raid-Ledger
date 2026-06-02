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
      // ROK-1307: drop user-fixable Steam-sync 4xx noise. Manual
      // `POST /auth/steam/sync` and `/auth/steam/sync-wishlist` raise
      // BadRequestException for unlinked Steam or private profile.
      // These are user-correctable conditions, NOT Sentry-worthy bugs.
      // Match on value (not type) so legacy bare `Error` payloads from
      // cron paths also drop.
      //
      // DO NOT add "Steam integration is not configured" here — that
      // ServiceUnavailableException signals a real ops issue (admin
      // forgot to set the Steam API key) and MUST stay visible in
      // Sentry. Codex review of ROK-1307 flagged this regression.
      if (
        typeof exceptionValue === 'string' &&
        /Steam account not linked|User has no linked Steam account|Steam profile is private/.test(
          exceptionValue,
        )
      ) {
        return null;
      }
      // ROK-1328: defense-in-depth — drop cron_jobs FK violations (23503).
      // The primary fix self-heals CronJobService.jobCache (re-resolve the
      // job by name + retry the insert once) so a stale cached job.id after a
      // cron_jobs row deletion no longer re-throws the FK on every tick. This
      // filter is the second line of defense: if any path ever re-throws the
      // FK error, Sentry MUST still drop it so the ~2-events/min burst (1348
      // events in 11h) can't come back. Match on VALUE (the constraint name)
      // not type — the error reaches Sentry as a bare Error/PostgresError from
      // the cron tick, with the constraint name embedded in the message.
      if (
        typeof exceptionValue === 'string' &&
        /cron_job_executions_cron_job_id_fkey/.test(exceptionValue)
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
      //
      // Word boundaries on `\b5\d\d\b` are load-bearing: Discord application
      // error codes (50013 Missing Permissions, 50001 Missing Access, etc.)
      // start with `500` as a numeric prefix. Without `\b`, `/5\d\d/` would
      // mis-group those PERMANENT failures as transient network noise.
      if (
        exceptionType === 'DiscordAPIError' &&
        typeof exceptionValue === 'string' &&
        /\b5\d\d\b|ECONNRESET|ETIMEDOUT|getaddrinfo|fetch failed|\bnetwork\b/i.test(
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
