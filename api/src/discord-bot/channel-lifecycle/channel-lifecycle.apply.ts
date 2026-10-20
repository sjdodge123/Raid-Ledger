import { LIFECYCLE_DEFAULTS } from '@raid-ledger/contract';
import type { Guild } from 'discord.js';
import {
  archiveChannel,
  createTextChannel,
  ensureCategory,
  unarchiveChannel,
} from './channel-lifecycle.discord-ops';
import { setLifecycleState } from './channel-lifecycle.store';
import { findGameAnnouncementBinding } from './channel-lifecycle.store.queries';
import type {
  ApplyContext,
  ItemOutcome,
  PlannedGame,
} from './channel-lifecycle.types';

/**
 * ROK-1431 — the per-action executors of a live reconcile (spec §2.5 steps
 * 3–5). Each throws on failure; `channel-lifecycle.run.ts` owns the D14 error
 * policy. Pinned / manual bindings never reach here (`decideGame` → `none`).
 */

/** D10 topic: `<Game> on Raid Ledger — events, polls and hub posts. <url>`. */
export function lifecycleTopic(ctx: ApplyContext, game: PlannedGame): string {
  const url = `${ctx.clientUrl.replace(/\/$/, '')}/games/${game.row.gameId}`;
  return `${game.row.gameName} on Raid Ledger — events, polls and hub posts. ${url}`;
}

/** Best-effort delete of a channel we just created (R18); never throws. */
async function deleteOrphan(guild: Guild, channelId: string): Promise<void> {
  try {
    await guild.channels.delete(channelId, 'Raid Ledger: binding failed');
  } catch {
    // Best effort (§2.9: never Sentry a cleanup failure).
  }
}

/** Bind a just-created channel (only through `bind()`); on failure delete it (R18). */
async function bindNewChannel(
  ctx: ApplyContext,
  gameId: number,
  channelId: string,
): Promise<string> {
  try {
    const bound = await ctx.bindings.bind(
      ctx.guild.id,
      channelId,
      'text',
      'game-announcements',
      gameId,
    );
    return bound.binding.id;
  } catch (err) {
    await deleteOrphan(ctx.guild, channelId);
    throw err;
  }
}

/** Create → bind (only through `bind()`) → mark auto-managed → link hubs. */
async function applyCreate(
  ctx: ApplyContext,
  game: PlannedGame,
): Promise<ItemOutcome> {
  const { gameId, gameSlug } = game.row;
  const guildId = ctx.guild.id;
  if (await findGameAnnouncementBinding(ctx.db, guildId, gameId)) {
    return { outcome: 'failed', detail: 'a binding appeared since the read' };
  }
  const channelId = await createTextChannel(ctx.guild, {
    name: gameSlug,
    parentId: ctx.categories.gamesId,
    topic: lifecycleTopic(ctx, game),
  });
  const bindingId = await bindNewChannel(ctx, gameId, channelId);
  await setLifecycleState(ctx.db, bindingId, {
    autoManaged: true,
    lifecycleState: 'active',
  });
  const linkedHubs = await ctx.hubLinker.linkHubsForGame(gameId, channelId);
  return { outcome: 'done', detail: `#${gameSlug}`, linkedHubs };
}

/** Archive (D6): deny + move into Archived (overflow-aware), keep the old parent. */
async function applyArchive(
  ctx: ApplyContext,
  game: PlannedGame,
  binding: { id: string; channelId: string },
): Promise<ItemOutcome> {
  const category = await ensureCategory(ctx.guild, {
    id: ctx.categories.archiveId,
    name: LIFECYCLE_DEFAULTS.archiveCategoryName,
    needsRoom: true,
  });
  const { previousParentId } = await archiveChannel(
    ctx.guild,
    binding.channelId,
    { categoryId: category.id, hide: ctx.settings.hideOnArchive },
  );
  await setLifecycleState(ctx.db, binding.id, {
    lifecycleState: 'archived',
    archivedAt: ctx.now,
    restoreParentId: previousParentId,
  });
  return { outcome: 'done', detail: game.reason };
}

/** Unarchive (D6): move back to `restore_parent_id` ?? Games, clear the deny. */
async function applyUnarchive(
  ctx: ApplyContext,
  game: PlannedGame,
  binding: { id: string; channelId: string; restoreParentId: string | null },
): Promise<ItemOutcome> {
  await unarchiveChannel(ctx.guild, binding.channelId, {
    parentId: binding.restoreParentId ?? ctx.categories.gamesId,
  });
  await setLifecycleState(ctx.db, binding.id, {
    lifecycleState: 'active',
    archivedAt: null,
    restoreParentId: null,
  });
  return { outcome: 'done', detail: game.reason };
}

/** Run one planned game's action against Discord + the DB. */
export async function applyAction(
  ctx: ApplyContext,
  game: PlannedGame,
): Promise<ItemOutcome> {
  const { binding, gameId } = game.row;
  if (game.action === 'create') return applyCreate(ctx, game);
  if (!binding) return { outcome: 'failed', detail: 'no binding' };
  if (game.action === 'archive') return applyArchive(ctx, game, binding);
  if (game.action === 'unarchive') return applyUnarchive(ctx, game, binding);
  if (game.action === 'link_hub') {
    const n = await ctx.hubLinker.linkHubsForGame(gameId, binding.channelId);
    return { outcome: 'done', detail: game.reason, linkedHubs: n };
  }
  return { outcome: 'done', detail: game.reason };
}
