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
  const code = err.getStatus() === 400 ? 'validation_failed' : 'unknown';
  const hub: HubError = { error: code };
  return hub;
}

/**
 * One error shape for every hub endpoint (L7, ROK-1671): hub errors pass
 * through, Nest's own errors become `{error}` with their status, and anything
 * else is a 500 `{error: 'unknown'}`. Messages of unexpected errors are never
 * sent or logged: a driver error can carry column values (a token hash).
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
    const name = err instanceof Error ? err.name : typeof err;
    this.logger.error(`Unhandled ${name} while serving a request`);
    const body: HubError = { error: 'unknown' };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
