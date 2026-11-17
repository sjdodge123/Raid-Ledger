/**
 * ROK-2250: an instance with no Blizzard API keys answers Blizzard-backed
 * requests (character preview, imports, realm/instance lookups) with a 503
 * the user can read — not a bare 500 that also reported to Sentry.
 *
 * The body's `error` code is in the Sentry intentional-503 list
 * (`api/src/sentry/sentry-intentional-unavailable.helpers.ts`), so beforeSend
 * drops it: a missing optional config is not a bug. Cron/sync callers gate on
 * `SettingsService.isBlizzardConfigured()` or catch and log per item.
 */
import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';

/** Response-body `error` code; must stay in INTENTIONAL_UNAVAILABLE_CODES. */
export const BLIZZARD_NOT_CONFIGURED = 'blizzard_not_configured';

export class BlizzardNotConfiguredError extends ServiceUnavailableException {
  constructor() {
    super({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: BLIZZARD_NOT_CONFIGURED,
      message:
        'Blizzard API not configured — an admin needs to add the Blizzard API keys.',
    });
  }
}
