import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { isPerfEnabled, perfLog } from './perf-logger';

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
        const userId = (req as Request & { user?: { sub?: number } }).user?.sub;

        perfLog('HTTP', `${req.method} ${req.url}`, durationMs, {
          status: res.statusCode,
          userId: userId ?? undefined,
        });
      }),
    );
  }
}
