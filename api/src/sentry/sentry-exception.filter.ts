import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';

/**
 * Global exception filter that captures errors in Sentry and sends proper
 * HTTP responses.
 *
 * Why not extend SentryGlobalFilter?
 * SentryGlobalFilter extends BaseExceptionFilter, which requires
 * HttpAdapterHost from the DI container. Since this filter is registered
 * via app.useGlobalFilters(new ...) outside DI, HttpAdapterHost is
 * undefined — causing a TypeError crash on every HTTP error response.
 *
 * This filter handles both HTTP and non-HTTP contexts safely:
 * - HTTP: captures 5xx in Sentry, sends proper JSON error response
 * - Non-HTTP (WebSocket, lifecycle hooks): captures in Sentry and re-throws
 *
 * ROK-367
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  /** Handle an HTTP exception by sending the appropriate JSON response. */
  private handleHttpException(response: Response, exception: unknown): void {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) Sentry.captureException(exception);
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
    } else {
      Sentry.captureException(exception);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    }
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      const response = host.switchToHttp().getResponse<Response>();
      if (response.headersSent) return;
      this.handleHttpException(response, exception);
      return;
    }
    Sentry.captureException(exception);
    throw exception;
  }
}
