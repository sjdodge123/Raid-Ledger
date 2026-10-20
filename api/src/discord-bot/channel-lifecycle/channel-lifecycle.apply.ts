import { LIFECYCLE_DEFAULTS } from '@raid-ledger/contract';
import type { Guild } from 'discord.js';
import {
  archiveChannel,
  categoryHasRoom,
  categorySeriesIds,
  createTextChannel,
  ensureCategory,
  revertArchive,
  setTopic,
  unarchiveChannel,
  type EnsuredCategory,
} from './channel-lifecycle.discord-ops';
import { lifecycleCall } from './channel-lifecycle.errors';
import { setLifecycleState } from './channel-lifecycle.store';
import { findGameAnnouncementBinding } from './channel-lifecycle.store.queries';
import type {
  ApplyContext,
  ItemOutcome,
  PlannedGame,
} from './channel-lifecycle.types';
import type { LifecycleCandidateBinding } from './game-activity.types';
import { resolveGameHubLink } from './hub-link.resolver';

/**
 * ROK-1431 — the per-action executors of a live reconcile (spec §2.5 steps
 * 3–5). Each throws on failure; `channel-lifecycle.run.ts` owns the D14 error
 * policy. Pinned / manual bindings never reach here (`decideGame` → `none`).
 */

/** D10 topic: `<Game> on Raid Ledger — events, polls and hub posts. <hub or game url>`. */
export function lifecycleTopic(
  ctx: ApplyContext,
  game: PlannedGame,
  hubUrl?: string,
): string {
  const gameUrl = `${ctx.clientUrl.replace(/\/$/, '')}/games/${game.row.gameId}`;
  return `${game.row.gameName} on Raid Ledger — events, polls and hub posts. ${hubUrl ?? gameUrl}`;
}

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
 * Link the game's hubs to `channelId`. Only an auto-managed channel's topic is
 * refreshed (Codex r3 P1): a manual binding's topic is the admin's.
 */
async function linkHubs(
  ctx: ApplyContext,
  game: PlannedGame,
  channel: { id: string; autoManaged: boolean },
): Promise<number> {
  const n = await ctx.hubLinker.linkHubsForGame(game.row.gameId, channel.id);
  if (n > 0 && channel.autoManaged) await refreshTopic(ctx, game, channel.id);
  return n;
}

/** The Games parent for a create; a full category overflows (D5 / §2.13). */
async function gamesParent(ctx: ApplyContext): Promise<string | null> {
  if (ctx.categories.gamesId === null) return null;
  const cat = await ensureCategory(ctx.guild, {
    id: ctx.categories.gamesId,
    name: LIFECYCLE_DEFAULTS.gamesCategoryName,
    needsRoom: true,
  });
  return cat.id;
}

/** Best-effort delete of a channel we just created (R18); never throws. */
async function deleteOrphan(guild: Guild, channelId: string): Promise<void> {
  try {
    await lifecycleCall('delete', channelId, () =>
      guild.channels.delete(channelId, 'Raid Ledger: binding failed'),
    );
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
    parentId: await gamesParent(ctx),
    topic: lifecycleTopic(ctx, game),
  });
  const bindingId = await bindNewChannel(ctx, gameId, channelId);
  await setLifecycleState(ctx.db, bindingId, {
    autoManaged: true,
    lifecycleState: 'active',
  });
  const linkedHubs = await linkHubs(ctx, game, {
    id: channelId,
    autoManaged: true,
  });
  return { outcome: 'done', detail: `#${gameSlug}`, linkedHubs };
}

/** The Archived series (default + configured names, overflow) — never a restore target. */
function archiveSeries(
  ctx: ApplyContext,
  category: EnsuredCategory,
): Set<string> {
  const ids = categorySeriesIds(
    ctx.guild,
    LIFECYCLE_DEFAULTS.archiveCategoryName,
  );
  for (const id of categorySeriesIds(ctx.guild, category.name)) ids.add(id);
  ids.add(category.id);
  if (ctx.categories.archiveId !== null) ids.add(ctx.categories.archiveId);
  return ids;
}

/**
 * Archive (D6): lock + move into Archived (overflow-aware), recording the old
 * parent and the bits added. A failed DB write undoes the Discord side, so a
 * retry starts again from the pre-archive state.
 */
async function applyArchive(
  ctx: ApplyContext,
  game: PlannedGame,
  binding: LifecycleCandidateBinding,
): Promise<ItemOutcome> {
  const category = await ensureCategory(ctx.guild, {
    id: ctx.categories.archiveId,
    name: LIFECYCLE_DEFAULTS.archiveCategoryName,
    needsRoom: true,
  });
  const res = await archiveChannel(ctx.guild, binding.channelId, {
    categoryId: category.id,
    hide: ctx.settings.hideOnArchive,
    seriesIds: archiveSeries(ctx, category),
  });
  try {
    await setLifecycleState(ctx.db, binding.id, {
      lifecycleState: 'archived',
      archivedAt: ctx.now,
      restoreParentId: res.restoreParentId,
      archivedOverwrites: res.added,
    });
  } catch (err) {
    await revertArchive(ctx.guild, binding.channelId, res);
    throw err;
  }
  return { outcome: 'done', detail: game.reason };
}

/**
 * The unarchive parent: `restore_parent_id` while it exists with room, else a
 * Games category with room (overflow-aware, D5 / §2.13), or none.
 */
async function restoreParent(
  ctx: ApplyContext,
  binding: LifecycleCandidateBinding,
): Promise<string | null> {
  const saved = binding.restoreParentId;
  if (saved !== null && (await categoryHasRoom(ctx.guild, saved))) return saved;
  return gamesParent(ctx);
}

/** Unarchive (D6): move back to `restoreParent`, clear only the bits archive added. */
async function applyUnarchive(
  ctx: ApplyContext,
  game: PlannedGame,
  binding: LifecycleCandidateBinding,
): Promise<ItemOutcome> {
  await unarchiveChannel(ctx.guild, binding.channelId, {
    parentId: await restoreParent(ctx, binding),
    added: binding.archivedOverwrites,
  });
  await setLifecycleState(ctx.db, binding.id, {
    lifecycleState: 'active',
    archivedAt: null,
    restoreParentId: null,
    archivedOverwrites: null,
  });
  return { outcome: 'done', detail: game.reason };
}

/** Run one planned game's action against Discord + the DB. */
export async function applyAction(
  ctx: ApplyContext,
  game: PlannedGame,
): Promise<ItemOutcome> {
  const { binding } = game.row;
  if (game.action === 'create') return applyCreate(ctx, game);
  if (!binding) return { outcome: 'failed', detail: 'no binding' };
  if (game.action === 'archive') return applyArchive(ctx, game, binding);
  if (game.action === 'unarchive') return applyUnarchive(ctx, game, binding);
  if (game.action === 'link_hub') {
    const n = await linkHubs(ctx, game, {
      id: binding.channelId,
      autoManaged: binding.autoManaged,
    });
    return { outcome: 'done', detail: game.reason, linkedHubs: n };
  }
  return { outcome: 'done', detail: game.reason };
}
