import type { INestApplication } from '@nestjs/common';

/**
 * Shared by main.ts and the integration spec so both serve the same routes:
 * every route under `/api` (L5), and clean exit on SIGTERM (L9, RH-5).
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
