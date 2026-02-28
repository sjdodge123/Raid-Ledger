// Sentry instrumentation MUST be imported first — before any other modules.
// ROK-306: Maintainer telemetry for error tracking.
import './sentry/instrument';

import { NestFactory } from '@nestjs/core';
import type { LogLevel } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import * as path from 'path';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './sentry/sentry-exception.filter';
import { ThrottlerExceptionFilter } from './throttler/throttler-exception.filter';

async function bootstrap() {
  const isDebug = process.env.DEBUG === 'true';
  const logLevels: LogLevel[] = isDebug
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn', 'log'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
    // Increase JSON body limit for feedback screenshots (base64)
    rawBody: false,
  });

  // Increase body parser limit (default 100kb is too small for screenshot payloads)
  app.useBodyParser('json', { limit: '8mb' });

  // Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
  app.use(helmet());

  // Compress responses > 1KB (~70% reduction for JSON payloads)
  app.use(compression({ threshold: 1024 }));

  // CORS configuration with environment validation
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;

  if (isProduction && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable must be set in production',
    );
  }

  // Reject wildcard CORS in production — credentials: true + '*' is dangerous
  if (isProduction && corsOrigin === '*') {
    throw new Error(
      'CORS_ORIGIN=* is not allowed in production. Set a specific origin.',
    );
  }

  // "auto" mode: all-in-one Docker image where frontend + API share the same
  // origin behind nginx. Dynamically allow the request's own origin so the
  // container works on any hostname without explicit CORS_ORIGIN configuration.
  const isAutoOrigin = corsOrigin === 'auto';

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Auto mode: allow the request's own origin (safe for co-located frontend/API)
      if (isAutoOrigin) return callback(null, true);

      // Wildcard allows all origins (used for all-in-one Docker image in dev)
      if (corsOrigin === '*') return callback(null, true);

      // Build allowed origins list — only include localhost in development
      const allowedOrigins: string[] = [corsOrigin].filter(Boolean) as string[];
      if (!isProduction) {
        allowedOrigins.push(
          'http://localhost',
          'http://localhost:80',
          'http://localhost:5173',
          'http://localhost:5174',
        );
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  // Trust first proxy hop (nginx/Render LB) so req.protocol honors X-Forwarded-Proto
  if (process.env.NODE_ENV === 'production') {
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.getInstance().set('trust proxy', 1);
  }

  // Serve uploaded avatars as static files (ROK-220)
  const avatarDir =
    process.env.AVATAR_UPLOAD_DIR ||
    (isProduction
      ? '/data/avatars'
      : path.join(process.cwd(), 'uploads', 'avatars'));
  app.useStaticAssets(avatarDir, { prefix: '/avatars/', maxAge: '7d' });

  // Serve community branding uploads as static files (ROK-271)
  const brandingDir = isProduction
    ? '/data/uploads/branding'
    : path.join(process.cwd(), 'uploads', 'branding');
  app.useStaticAssets(brandingDir, {
    prefix: '/uploads/branding/',
    maxAge: '1d',
  });

  // NestJS applies global filters in reverse order: ThrottlerExceptionFilter runs
  // first, then SentryExceptionFilter. ThrottlerException is dropped by beforeSend
  // in instrument.ts so rate-limit responses are never reported to Sentry.
  app.useGlobalFilters(
    new SentryExceptionFilter(),
    new ThrottlerExceptionFilter(),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
