import { Catch, ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    res.status(429).json({
      statusCode: 429,
      message: 'Too many requests. Please try again later.',
      retryAfter: 60,
    });
  }
}
