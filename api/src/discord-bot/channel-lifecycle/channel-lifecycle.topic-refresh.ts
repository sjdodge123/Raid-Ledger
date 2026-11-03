import { Logger } from '@nestjs/common';
import { lifecycleTopic } from './channel-lifecycle.apply';
import { setTopic } from './channel-lifecycle.discord-ops';
import { LifecyclePermissionError } from './channel-lifecycle.errors';
import type {
  ApplyContext,
  ItemOutcome,
  PlannedGame,
} from './channel-lifecycle.types';
import { resolveGameHubLink } from './hub-link.resolver';

const logger = new Logger('ChannelLifecycleTopic');

/** D10/OQ-7: after a hub link, point the topic at the hub. */
async function refreshTopic(
  ctx: ApplyContext,
  game: PlannedGame,
  channelId: string,
): Promise<void> {
  const link = await resolveGameHubLink(ctx.db, {
    gameId: game.row.gameId,
    clientUrl: ctx.clientUrl,
  });
  await setTopic(ctx.guild, channelId, lifecycleTopic(ctx, game, link?.url));
}

/**
 * Tech-debt 2026-10-22: the hub-link topic refresh runs AFTER the link's tx
 * committed, on the pool (`ctx.db`), so a Discord error (rate limit, missing
 * permission, deleted channel) never rolls back the link. A failure is logged
 * and the link kept; a permission error still stops the tick (D14), and a gone
 * channel is cleaned up by the next tick's sweep. Strips `topicChannelId`.
 */
export async function refreshTopicAfterCommit(
  ctx: ApplyContext,
  game: PlannedGame,
  item: ItemOutcome,
): Promise<ItemOutcome> {
  const { topicChannelId, ...rest } = item;
  if (topicChannelId === undefined) return rest;
  try {
    await refreshTopic(ctx, game, topicChannelId);
    return rest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Topic refresh after hub link failed for ${game.row.gameId}: ${message}`,
    );
    if (err instanceof LifecyclePermissionError) return { ...rest, stop: true };
    return rest;
  }
}
