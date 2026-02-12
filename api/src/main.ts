import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // CORS configuration with environment validation
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;

  if (isProduction && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable must be set in production',
    );
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Wildcard allows all origins (used for all-in-one Docker image)
      if (corsOrigin === '*') return callback(null, true);

      // Allowed origins
      const allowedOrigins = [
        'http://localhost',
        'http://localhost:80',
        'http://localhost:5173',
        corsOrigin,
      ].filter(Boolean);

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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
