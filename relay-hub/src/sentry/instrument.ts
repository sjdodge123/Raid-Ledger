/**
 * Sentry for the relay hub (ROK-1670, ruling D11). MUST be the first import of
 * main.ts and of the migration runner. A separate Sentry project: the DSN
 * comes only from `SENTRY_DSN`; unset or empty means log-only. Nothing here
 * is shared with api's instrument (no DSN, no beforeSend).
 */
import * as Sentry from '@sentry/nestjs';

/** Sentry v11 dropped `sendDefaultPii`; this is its documented `false`. */
const NO_PII_HEADERS = {
  deny: ['forwarded', '-ip', 'remote-', 'via', '-user'],
};
const HUB_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: NO_PII_HEADERS, response: NO_PII_HEADERS },
  httpBodies: [],
  urlQueryParams: NO_PII_HEADERS,
  databaseQueryData: false,
} satisfies Sentry.NodeOptions['dataCollection'];

export interface HubSentryEnv {
  readonly SENTRY_DSN?: string | undefined;
  readonly DISABLE_TELEMETRY?: string | undefined;
  readonly APP_VERSION?: string | undefined;
}

/** Inits Sentry when a DSN is set and telemetry is not disabled (L7). */
export function initHubSentry(env: HubSentryEnv): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || env.DISABLE_TELEMETRY === 'true') return false;
  Sentry.init({
    dsn,
    environment: 'relay-hub',
    ...(env.APP_VERSION ? { release: env.APP_VERSION } : {}),
    dataCollection: HUB_DATA_COLLECTION,
  });
  return true;
}

initHubSentry(process.env);
