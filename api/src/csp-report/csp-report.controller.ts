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

@Controller('csp-report')
@RateLimit('public')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  handle(@Body() report: unknown): void {
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
    this.logger.log({ event: 'csp_violation', report });
  }
}
