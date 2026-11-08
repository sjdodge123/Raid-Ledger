/**
 * ROK-2124: after a LedgerLink import APPLIED, try the Forever Armory
 * auto-link for that character straight away instead of waiting for the
 * hourly cron. Fire-and-forget: the import response never waits on
 * Blizzard, and a failure only logs (the cron retries on its own schedule).
 */
import type { Logger } from '@nestjs/common';
import type { ForeverAutoLinkService } from '../forever-auto-link/forever-auto-link.service';

/** The one method the nudge needs (keeps the unit spec's mock tiny). */
export type AutoLinkAttempter = Pick<ForeverAutoLinkService, 'attempt'>;

/**
 * Start an auto-link attempt without awaiting it. A null id (an import that
 * resolved no character) does nothing. Callers invoke it only on an apply,
 * never on a dry run.
 * @param autoLink - The auto-link service.
 * @param characterId - The imported character's id.
 * @param logger - Where a rejected attempt is reported.
 */
export function nudgeAutoLink(
  autoLink: AutoLinkAttempter,
  characterId: string | null,
  logger: Pick<Logger, 'warn'>,
): void {
  if (characterId === null) return;
  void autoLink.attempt(characterId).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`Forever auto-link nudge for ${characterId} failed: ${reason}`);
  });
}
