import type { Logger } from '@nestjs/common';
import type { AiSuggestionsCacheInvalidator } from './ai-suggestions/cache.helpers';

/**
 * Defensive wrapper around `AiSuggestionsCacheInvalidator` calls (ROK-931
 * reviewer finding). The invalidator already swallows errors itself, but a
 * test mock or future reimplementation could throw — wrapping at the service
 * boundary guarantees the parent mutation is never blocked by cache hygiene.
 * Extracted from `LineupsService` to keep it under the 300-line cap.
 */
export async function invalidateAiCacheSafely(
  cache: Pick<AiSuggestionsCacheInvalidator, 'invalidateForLineup'>,
  logger: Pick<Logger, 'warn'>,
  lineupId: number,
): Promise<void> {
  try {
    await cache.invalidateForLineup(lineupId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `AI suggestions cache invalidation failed for lineup ${lineupId}: ${msg}`,
    );
  }
}
