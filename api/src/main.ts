// Sentry instrumentation MUST be imported first — before any other modules.
// ROK-306: Maintainer telemetry for error tracking.
import './sentry/instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { AppModule } from './app.module';
import { applyCorsPolicy } from './cors/cors-auto-policy';
import { SentryExceptionFilter } from './sentry/sentry-exception.filter';
import { ThrottlerExceptionFilter } from './throttler/throttler-exception.filter';
import {
  validateCorsConfig,
  buildHelmetOptions,
  getLogLevels,
  buildLoggerSelfTest,
  installCspReportBodyParser,
  applyTrustProxy,
} from './main.helpers';

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
  const brandingDir =
    process.env.RAID_LEDGER_BRANDING_DIR ||
    (isProduction
      ? '/data/uploads/branding'
      : path.join(process.cwd(), 'uploads', 'branding'));
  app.useStaticAssets(brandingDir, {
    prefix: '/uploads/branding/',
    maxAge: '1d',
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: getLogLevels({
      DEBUG: process.env.DEBUG,
      LOG_LEVEL: process.env.LOG_LEVEL,
      NODE_ENV: process.env.NODE_ENV,
    }),
    rawBody: false,
  });
  // Register the CSP-violation-report parser BEFORE Nest's default json parser
  // so `@Body()` resolves the report payload. Wraps body-parser to 204 (not
  // 400) on a malformed report body. ROK-1158 / ROK-1365.
  installCspReportBodyParser(app);
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet(buildHelmetOptions()));
  app.use(compression({ threshold: 1024 }));
  // ROK-1353: parse the httpOnly `rl_rt` refresh cookie into req.cookies.
  app.use(cookieParser());
  const isProduction = process.env.NODE_ENV === 'production';
  validateCorsConfig(isProduction, process.env.CORS_ORIGIN);
  // ROK-1732: CORS_ORIGIN=auto is same-origin only (CORS_AUTO_MODE picks
  // report vs enforce); an explicit-origin mismatch is a 403, not a 500.
  applyCorsPolicy(app, { isProduction });
  // ROK-1665: trust private hops (TRUST_PROXY overrides), not a hop count.
  applyTrustProxy(app, isProduction, process.env.TRUST_PROXY);
  // ROK-1627: CLIENT_URL is seeded from trusted configuration by
  // ClientUrlSeederService — never from a request header.
  configureStaticAssets(app, isProduction);
  app.useGlobalFilters(
    new SentryExceptionFilter(),
    new ThrottlerExceptionFilter(),
  );
  await app.listen(process.env.PORT ?? 3000);
  if (process.env.LOGGER_SELF_TEST === 'true') {
    buildLoggerSelfTest(new Logger('Bootstrap'))();
  }
}
void bootstrap();
