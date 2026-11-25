import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Capture a boot-time failure, then wait for Sentry to flush (copied contract
 * of api's `run-migrations-with-sentry.ts::reportBootFailure`). The caller
 * exits afterwards. Logs only the error's name and message.
 */
export async function reportBootFailure(
  err: unknown,
  context: string,
): Promise<void> {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : 'error';
  new Logger('relay-hub').error(`Boot failure (${context}): ${detail}`);
  Sentry.captureException(err, { tags: { context } });
  await Sentry.flush(2000);
}
