/**
 * Delete the Discord poll cards a re-decide orphaned (TDB:571).
 *
 * A re-decide wipes `suggested`/`scheduling` matches and re-inserts from the
 * fresh tally. A wiped `scheduling` match may already own a live card whose
 * buttons point at a match id that no longer exists, so the card is DELETED
 * (not re-rendered as closed — there is no terminal copy for "superseded").
 * If the re-decide re-creates a scheduling match, it gets a fresh card through
 * the ROK-1473 entered-scheduling hook.
 *
 * Extracted from `SchedulingPollEmbedService` to keep it under the 300-line cap.
 */
import type { Logger } from '@nestjs/common';
import type { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { isUnknownMessage } from '../../discord-bot/discord-bot-client.messages.helpers';
import type { OrphanedPollCard } from '../lineups-scheduling-hook.helpers';

/**
 * Delete each orphaned card. One failure never stops the rest; a card that
 * is already gone (Discord 10008) counts as done.
 *
 * @param client - Bot client that owns the cards.
 * @param cards - Cards whose match rows the re-decide deleted.
 * @param logger - Caller's logger; failures are warned, never thrown.
 */
export async function deleteOrphanedPollCards(
  client: Pick<DiscordBotClientService, 'deleteMessage'>,
  cards: OrphanedPollCard[],
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  for (const card of cards) {
    try {
      await client.deleteMessage(card.channelId, card.messageId);
    } catch (err: unknown) {
      if (isUnknownMessage(err)) continue;
      logger.warn(
        `Failed to delete orphaned poll card ${card.messageId} in ${
          card.channelId
        }: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
