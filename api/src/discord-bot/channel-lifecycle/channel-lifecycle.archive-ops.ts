/**
 * Archive / unarchive Discord ops for the game-channel lifecycle (ROK-1431,
 * spec ROK-1428 D6). The overwrite plan and its inverse live in
 * `channel-lifecycle.overwrites.ts`: archive records every bit it changes with
 * its prior state; unarchive (and a failed archive's rollback) restores those
 * priors against a fresh API read, so admin-made privacy survives and the bot
 * keeps posting into an archived channel.
 */
import type { Guild } from 'discord.js';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import { lifecycleCall, resolveTextChannel } from './channel-lifecycle.errors';
import {
  planArchive,
  restorePriors,
  toChanges,
  writeLock,
  type OverwriteIds,
} from './channel-lifecycle.overwrites';
import type { ArchivedOverwriteChange } from '../../drizzle/schema/channel-bindings';

/** What `archiveChannel` did, for the binding row and a revert. */
export interface ArchiveResult {
  /** The parent the channel had before the move (for a revert). */
  previousParentId: string | null;
  /** The parent to store as `restore_parent_id` — null when it was an Archived-series category. */
  restoreParentId: string | null;
  /** The bits archive changed, with their prior state (`archived_overwrites`). */
  added: ArchivedOverwrites;
}

/** Move a channel without syncing its overwrites to the new parent. */
async function moveChannel(
  guild: Guild,
  op: string,
  channelId: string,
  parentId: string | null,
): Promise<void> {
  await lifecycleCall(op, channelId, () =>
    guild.channels.edit(channelId, {
      parent: parentId,
      lockPermissions: false,
    }),
  );
}

const idsOf = (guild: Guild): OverwriteIds => ({
  everyoneId: guild.id,
  botId: guild.client.user.id,
});

/** Restore `changes` against a fresh (API, not gateway-cache) read. */
async function restoreFresh(
  guild: Guild,
  channelId: string,
  changes: ArchivedOverwriteChange[],
): Promise<void> {
  const fresh = await resolveTextChannel(guild, channelId, { fresh: true });
  await restorePriors(fresh.permissionOverwrites, idsOf(guild), changes);
}

/** Run a cleanup step; a failure is swallowed (§2.9: never Sentry a cleanup). */
async function bestEffort(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Best effort — the caller rethrows the original failure.
  }
}

/**
 * Archive (D6): deny `@everyone` SendMessages (+ ViewChannel when `hide`),
 * explicitly allow the same bits for the bot, then move under `categoryId`. A
 * lock/move failure restores the priors from a fresh read before rethrowing.
 * A parent in `seriesIds` (the Archived series) is not a restore target, so
 * `restoreParentId` is null (→ Games).
 */
export async function archiveChannel(
  guild: Guild,
  channelId: string,
  opts: { categoryId: string; hide: boolean; seriesIds?: ReadonlySet<string> },
): Promise<ArchiveResult> {
  const channel = await resolveTextChannel(guild, channelId, { fresh: true });
  const po = channel.permissionOverwrites;
  const previousParentId = channel.parentId;
  const changes = planArchive(po, idsOf(guild), opts.hide);
  try {
    await lifecycleCall('archive.lock', channelId, () =>
      writeLock(po, idsOf(guild), changes),
    );
    await moveChannel(guild, 'archive.move', channelId, opts.categoryId);
  } catch (err) {
    await bestEffort(() => restoreFresh(guild, channelId, changes));
    throw err;
  }
  const inSeries =
    previousParentId !== null &&
    (opts.seriesIds?.has(previousParentId) ?? false);
  return {
    previousParentId,
    restoreParentId: inSeries ? null : previousParentId,
    added: { changes },
  };
}

/**
 * Undo a successful `archiveChannel` (its DB write failed): move back to the
 * previous parent and restore the priors. Best effort — never throws.
 */
export async function revertArchive(
  guild: Guild,
  channelId: string,
  res: ArchiveResult,
): Promise<void> {
  await bestEffort(async () => {
    await moveChannel(guild, 'archive.revert', channelId, res.previousParentId);
    await restoreFresh(guild, channelId, toChanges(res.added));
  });
}

/**
 * Unarchive (D6): move back to `parentId`, then restore the recorded priors
 * (a v1 record clears its bits; null → the legacy send lock only).
 */
export async function unarchiveChannel(
  guild: Guild,
  channelId: string,
  opts: { parentId: string | null; added?: ArchivedOverwrites | null },
): Promise<void> {
  const channel = await resolveTextChannel(guild, channelId, { fresh: true });
  await moveChannel(guild, 'unarchive.move', channelId, opts.parentId);
  await lifecycleCall('unarchive.unlock', channelId, () =>
    restorePriors(
      channel.permissionOverwrites,
      idsOf(guild),
      toChanges(opts.added),
    ),
  );
}
