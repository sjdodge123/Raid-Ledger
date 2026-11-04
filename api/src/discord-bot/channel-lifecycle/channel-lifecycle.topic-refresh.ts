import { Logger } from '@nestjs/common';
import { lifecycleTopic } from './channel-lifecycle.apply';
import { staleLinkDetail } from './channel-lifecycle.decide';
import { setTopic } from './channel-lifecycle.discord-ops';
import { LifecyclePermissionError } from './channel-lifecycle.errors';
import { lockLifecycleBinding } from './channel-lifecycle.store.queries';
import type {
  ApplyContext,
  ItemOutcome,
  PlannedGame,
  TopicTarget,
} from './channel-lifecycle.types';
import { resolveGameHubLink } from './hub-link.resolver';

const logger = new Logger('ChannelLifecycleTopic');

/**
 * Codex P2 (2026-11-03): the link tx has committed, so an admin may have
 * unbound, re-pointed or taken over the binding since. Re-lock it and say why
 * the topic must be left alone, or null when it is still this game's.
 */
async function staleTopicDetail(
  ctx: ApplyContext,
  game: PlannedGame,
  target: TopicTarget,
): Promise<string | null> {
  const current = await lockLifecycleBinding(ctx.db, target.bindingId);
  const planned = { channelId: target.channelId, gameId: game.row.gameId };
  const stale = staleLinkDetail(planned, current);
  if (stale !== null || !current) return stale;
  return current.autoManaged ? null : 'skipped: no longer auto-managed';
}

/**
 * D10/OQ-7: after a hub link, point the topic at the hub. Runs on `ctx.db` =
 * its own tx, holding the binding's row lock through the Discord edit (as the
 * pre-split link tx did), so an unbind / `updateConfig` cannot land mid-edit.
 */
async function refreshTopicLocked(
  ctx: ApplyContext,
  game: PlannedGame,
  target: TopicTarget,
): Promise<void> {
  const stale = await staleTopicDetail(ctx, game, target);
  if (stale !== null) {
    logger.debug(`Topic refresh for ${game.row.gameId} ${stale}`);
    return;
  }
  const link = await resolveGameHubLink(ctx.db, {
    gameId: game.row.gameId,
    clientUrl: ctx.clientUrl,
  });
  const topic = lifecycleTopic(ctx, game, link?.url);
  await setTopic(ctx.guild, target.channelId, topic);
}

/**
 * Tech-debt 2026-10-22: the hub-link topic refresh runs AFTER the link's tx
 * committed, in a separate tx, so a Discord error (rate limit, missing
 * permission, deleted channel) never rolls back the link. A failure is logged
 * and the link kept; a permission error still stops the tick (D14), and a gone
 * channel is cleaned up by the next tick's sweep. Strips `topic`.
 */
export async function refreshTopicAfterCommit(
  ctx: ApplyContext,
  game: PlannedGame,
  item: ItemOutcome,
): Promise<ItemOutcome> {
  const { topic, ...rest } = item;
  if (topic === undefined) return rest;
  try {
    await ctx.db.transaction((tx) =>
      refreshTopicLocked({ ...ctx, db: tx }, game, topic),
    );
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
