import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap, catchError } from 'rxjs';
import type { Request, Response } from 'express';
import { isPerfEnabled, perfLog } from './perf-logger';

type AuthRequest = Request & { user?: { sub?: number } };

/** Extract HTTP status from an error, defaulting to 500 for non-HttpException errors. */
function getErrorStatus(err: unknown): number {
  if (
    err != null &&
    typeof err === 'object' &&
    'getStatus' in err &&
    typeof (err as { getStatus: unknown }).getStatus === 'function'
  ) {
    return (err as { getStatus: () => number }).getStatus();
  }
  return 500;
}

/**
 * Global HTTP request/response timing interceptor (ROK-563).
 * Logs method, URL, status, duration, and userId when DEBUG=true.
 */
@Injectable()
export class PerfLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!isPerfEnabled()) return next.handle();

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const start = performance.now();

    return next.handle().pipe(
      tap(() => {
        const res = httpCtx.getResponse<Response>();
        const durationMs = performance.now() - start;
        const userId = (req as AuthRequest).user?.sub;

        perfLog('HTTP', `${req.method} ${req.url}`, durationMs, {
          status: res.statusCode,
          userId: userId ?? undefined,
        });
      }),
      catchError((err: unknown) => {
        const durationMs = performance.now() - start;
        const userId = (req as AuthRequest).user?.sub;

        perfLog('HTTP', `${req.method} ${req.url}`, durationMs, {
          status: getErrorStatus(err),
          userId: userId ?? undefined,
        });

        throw err;
      }),
    );
  }
}
