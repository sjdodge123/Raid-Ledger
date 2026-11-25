import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { HubError } from '@raid-ledger/contract';
import type { Response } from 'express';
import { HubHttpException } from './hub-errors';

/** Body to send for an HttpException that is not a {@link HubHttpException}. */
function bodyFor(err: HttpException): unknown {
  const body = err.getResponse();
  // A controller's own object body (no Nest `statusCode`) is deliberate:
  // e.g. health's `/ready` 503 `{status: 'unavailable'}` (ROK-1670 L6).
  if (typeof body === 'object' && body !== null && !('statusCode' in body)) {
    return body;
  }
  return clientFault(err.getStatus());
}

/** The hub body for a client-fault status: 400 is a validation failure. */
function clientFault(status: number): HubError {
  return { error: status === 400 ? 'validation_failed' : 'unknown' };
}

/**
 * A 4xx `statusCode` carried by a non-Nest error: body-parser's http-errors
 * (413 over the JSON limit, 415 unsupported charset, 400 aborted), the way
 * Nest's own `BaseExceptionFilter.isHttpError` honours them. Else undefined.
 */
export function clientFaultStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if (!('statusCode' in err)) return undefined;
  const { statusCode } = err;
  if (typeof statusCode !== 'number') return undefined;
  return statusCode >= 400 && statusCode < 500 ? statusCode : undefined;
}

/** Name plus a Postgres `code` when present: neither carries row values. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  return code ? `${err.name} (code ${code})` : err.name;
}

/**
 * One error shape for every hub endpoint (L7, ROK-1671): hub errors pass
 * through, Nest's own errors become `{error}` with their status, and anything
 * else is a 500 `{error: 'unknown'}` unless it carries a 4xx `statusCode`.
 * Messages of unexpected errors are never sent or logged: a driver error
 * can carry column values (a token hash).
 */
@Catch()
export class HubExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HubExceptionFilter');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HubHttpException) {
      res.status(err.getStatus()).json(err.body);
      return;
    }
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json(bodyFor(err));
      return;
    }
    const status = clientFaultStatus(err);
    if (status !== undefined) {
      res.status(status).json(clientFault(status));
      return;
    }
    this.logger.error(
      `Unhandled ${describeError(err)} while serving a request`,
    );
    const body: HubError = { error: 'unknown' };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
