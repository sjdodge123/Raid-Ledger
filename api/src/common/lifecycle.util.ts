import { Logger } from '@nestjs/common';

/**
 * Wraps a best-effort onModuleInit callback so that failures are logged
 * but do not crash the NestJS bootstrap.
 *
 * Use this for hooks that warm caches, seed data, or close orphaned sessions --
 * things the app can survive without. Startup-critical hooks (settings,
 * plugin registry, Discord module) should NOT use this; annotate those with
 * `// STARTUP-CRITICAL` instead.
 *
 * @param label  Human-readable name shown in the error log
 * @param logger NestJS Logger instance from the calling service/module
 * @param fn     Async callback to execute
 */
export async function bestEffortInit(
  label: string,
  logger: Logger,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    logger.error(
      `[bestEffortInit] ${label} failed — feature degraded but app continues`,
      err instanceof Error ? err.stack : err,
    );
  }
}
