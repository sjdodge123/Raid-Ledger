import { ArgumentsHost, Catch } from '@nestjs/common';
import type { Response } from 'express';
import { SentryExceptionFilter } from '../../sentry/sentry-exception.filter';

/**
 * ROK-1956 §9 — every error answer on the companion ingest/blob routes closes
 * the connection: a rejected request (guard 401/429, body cap, bad gzip, an
 * unexpected 500) may leave unread body bytes that must not poison the
 * keep-alive socket. Route-scoped (`@UseFilters`), so it replaces the global
 * filter there; it delegates to `SentryExceptionFilter` for the body (a
 * non-`HttpException` becomes a generic 500) and the Sentry capture. A copy of
 * the Valheim Link filter — Core does not import plugin code.
 */
@Catch()
export class CompanionConnectionCloseFilter extends SentryExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      const res = host.switchToHttp().getResponse<Response>();
      if (!res.headersSent) res.setHeader('Connection', 'close');
    }
    super.catch(exception, host);
  }
}
