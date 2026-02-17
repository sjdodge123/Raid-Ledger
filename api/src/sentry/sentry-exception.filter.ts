import { Catch, ArgumentsHost } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import * as Sentry from '@sentry/nestjs';

/**
 * Wraps SentryGlobalFilter to handle non-HTTP contexts safely.
 *
 * SentryGlobalFilter extends BaseExceptionFilter, which calls
 * host.switchToHttp().getResponse().isHeadersSent — this crashes with a
 * TypeError when the exception originates from a WebSocket, microservice,
 * or lifecycle-hook context where there is no HTTP response object.
 *
 * For non-HTTP contexts we capture the exception directly via the Sentry SDK
 * and re-throw so NestJS's default handling still applies.
 *
 * ROK-367
 */
@Catch()
export class SentryExceptionFilter extends SentryGlobalFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      super.catch(exception, host);
      return;
    }

    // Non-HTTP context — capture directly and re-throw
    Sentry.captureException(exception);
    throw exception;
  }
}
