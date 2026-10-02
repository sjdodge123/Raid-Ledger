import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { isCloudflareBeaconCspReport } from './csp-report-noise.helpers';

@Controller('csp-report')
@RateLimit('public')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  handle(@Body() report: unknown): void {
    // ROK-1501: Cloudflare's RUM beacon trips the CSP on every page load of a
    // proxied host and exhausted the org's Sentry error quota. Keep it out of
    // Sentry, but still write it to the app log so nothing is silently lost.
    const cloudflareBeacon = isCloudflareBeaconCspReport(report);
    if (!cloudflareBeacon) {
      try {
        Sentry.captureMessage('CSP violation', {
          level: 'warning',
          tags: { source: 'csp_report' },
          extra: { report },
        });
      } catch (err) {
        this.logger.warn(
          `Sentry.captureMessage failed for CSP report: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log({
      event: 'csp_violation',
      report,
      ...(cloudflareBeacon && { ignored: 'cloudflare_beacon' }),
    });
  }
}
