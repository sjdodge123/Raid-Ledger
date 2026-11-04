import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { isCloudflareBeaconCspReport } from './csp-report-noise.helpers';
import { CspSentryBudget, logSafeReport } from './csp-report-guard';
import {
  CSP_REPORT_ROUTE,
  isCspReportContentType,
} from './csp-report.constants';

/** Why a report was kept out of Sentry (still logged). */
type IgnoredReason = 'cloudflare_beacon' | 'sentry_budget';

@Controller(CSP_REPORT_ROUTE)
@RateLimit('public')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);
  /** One budget for the whole process: Nest controllers are singletons. */
  private readonly sentryBudget = new CspSentryBudget();

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  handle(
    @Body() report: unknown,
    @Headers('content-type') contentType?: string,
  ): void {
    // Only browser CSP report types are reports: an application/json body
    // reaches here through Nest's 2MB default parser and is dropped unlogged.
    if (!isCspReportContentType(contentType)) {
      this.logger.log({
        event: 'csp_violation',
        ignored: 'content_type',
        contentType: (contentType ?? '').slice(0, 100),
      });
      return;
    }
    const ignored = this.captureUnlessIgnored(report);
    this.logger.log({
      event: 'csp_violation',
      ...logSafeReport(report),
      ...(ignored && { ignored }),
    });
  }

  /**
   * ROK-1501: Cloudflare's RUM beacon trips the CSP on every page load of a
   * proxied host and exhausted the org's Sentry error quota. Keep it out of
   * Sentry, and cap all other captures per minute so a few IPs can't do the
   * same on purpose. Ignored reports are still written to the app log.
   */
  private captureUnlessIgnored(report: unknown): IgnoredReason | null {
    if (isCloudflareBeaconCspReport(report)) return 'cloudflare_beacon';
    if (!this.sentryBudget.tryConsume()) return 'sentry_budget';
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
    return null;
  }
}
