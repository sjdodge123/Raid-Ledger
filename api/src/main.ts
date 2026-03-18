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
import {
  validateCorsConfig,
  buildCorsOriginFn,
  buildHelmetOptions,
} from './main.helpers';

function getLogLevels(): LogLevel[] {
  return process.env.DEBUG === 'true'
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn', 'log'];
}

function installAutoClientUrlDetection(app: NestExpressApplication): void {
  app.use(
    (
      req: { headers: Record<string, string | string[] | undefined> },
      _res: unknown,
      next: () => void,
    ) => {
      if (!process.env.CLIENT_URL) {
        const host = req.headers.host as string | undefined;
        if (
          host &&
          !host.startsWith('localhost') &&
          !host.startsWith('127.0.0.1')
        ) {
          const proto =
            ((req.headers['x-forwarded-proto'] as string) || 'http')
              .split(',')[0]
              .trim() || 'http';
          process.env.CLIENT_URL = `${proto}://${host}`;
        }
      }
      next();
    },
  );
}

function configureStaticAssets(
  app: NestExpressApplication,
  isProduction: boolean,
): void {
  const avatarDir =
    process.env.AVATAR_UPLOAD_DIR ||
    (isProduction
      ? '/data/avatars'
      : path.join(process.cwd(), 'uploads', 'avatars'));
  app.useStaticAssets(avatarDir, { prefix: '/avatars/', maxAge: '7d' });
  const brandingDir = isProduction
    ? '/data/uploads/branding'
    : path.join(process.cwd(), 'uploads', 'branding');
  app.useStaticAssets(brandingDir, {
    prefix: '/uploads/branding/',
    maxAge: '1d',
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: getLogLevels(),
    rawBody: false,
  });
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet(buildHelmetOptions()));
  app.use(compression({ threshold: 1024 }));
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  validateCorsConfig(isProduction, corsOrigin);
  const isAutoOrigin = corsOrigin === 'auto';
  app.enableCors({
    origin: buildCorsOriginFn(isProduction, corsOrigin, isAutoOrigin),
    credentials: true,
  });
  if (isProduction) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  if (isAutoOrigin && !process.env.CLIENT_URL)
    installAutoClientUrlDetection(app);
  configureStaticAssets(app, isProduction);
  app.useGlobalFilters(
    new SentryExceptionFilter(),
    new ThrottlerExceptionFilter(),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
