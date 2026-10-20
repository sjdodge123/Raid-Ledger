/**
 * Archive / unarchive Discord ops for the game-channel lifecycle (ROK-1431,
 * spec ROK-1428 D6). Archive records exactly which overwrite bits it ADDED
 * (`ArchivedOverwrites`); unarchive clears only those, so admin-made privacy
 * (a pre-existing `@everyone` ViewChannel deny, a bot allow) survives. A
 * failed archive is undone best-effort so the channel is never left locked
 * while its binding still reads `active`.
 */
import {
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type PermissionOverwriteManager,
  type PermissionOverwriteOptions,
} from 'discord.js';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import { lifecycleCall, resolveTextChannel } from './channel-lifecycle.errors';

type FlagName = keyof typeof PermissionFlagsBits;

/** Bits a binding archived before the record existed: only the send lock. */
export const LEGACY_ARCHIVED_OVERWRITES: ArchivedOverwrites = {
  everyoneSend: true,
  everyoneView: false,
  botView: false,
};

/** What `archiveChannel` did, for the binding row and a revert. */
export interface ArchiveResult {
  /** The parent the channel had before the move (for a revert). */
  previousParentId: string | null;
  /** The parent to store as `restore_parent_id` — null when it was an Archived-series category. */
  restoreParentId: string | null;
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

/** True when overwrite `id` has `flag` set in its `field` bitfield. */
function hasBit(
  po: PermissionOverwriteManager,
  id: string,
  field: 'allow' | 'deny',
  flag: FlagName,
): boolean {
  const ow = po.cache.get(id);
  return (
    ow !== undefined && (ow[field].bitfield & PermissionFlagsBits[flag]) !== 0n
  );
}

/** The bits archive must add — anything already in place is left alone. */
function bitsToAdd(
  po: PermissionOverwriteManager,
  guild: Guild,
  hide: boolean,
): ArchivedOverwrites {
  const everyoneView = hide && !hasBit(po, guild.id, 'deny', 'ViewChannel');
  return {
    everyoneSend: !hasBit(po, guild.id, 'deny', 'SendMessages'),
    everyoneView,
    botView:
      everyoneView && !hasBit(po, guild.client.user.id, 'allow', 'ViewChannel'),
  };
}

/** Write the added bits (bot allow first, so the bot keeps access). */
async function lockBits(
  po: PermissionOverwriteManager,
  guild: Guild,
  added: ArchivedOverwrites,
): Promise<void> {
  if (added.botView) {
    const type = OverwriteType.Member;
    await po.edit(guild.client.user.id, { ViewChannel: true }, { type });
  }
  const everyone: PermissionOverwriteOptions = {};
  if (added.everyoneSend) everyone.SendMessages = false;
  if (added.everyoneView) everyone.ViewChannel = false;
  if (Object.keys(everyone).length === 0) return;
  await po.edit(guild.id, everyone, { type: OverwriteType.Role });
}

/**
 * Clear `flags` from one overwrite: delete it when nothing else is left on it,
 * otherwise reset just those bits to inherit (`null`). Never writes an Allow.
 */
async function clearFlags(
  po: PermissionOverwriteManager,
  id: string,
  flags: FlagName[],
  type: OverwriteType,
): Promise<void> {
  const ow = po.cache.get(id);
  if (!ow || flags.length === 0) return;
  const mask = flags.reduce((acc, f) => acc | PermissionFlagsBits[f], 0n);
  if (((ow.allow.bitfield | ow.deny.bitfield) & ~mask) === 0n) {
    await po.delete(id);
    return;
  }
  const reset: PermissionOverwriteOptions = {};
  for (const f of flags) reset[f] = null;
  await po.edit(id, reset, { type });
}

/** Remove exactly the bits in `added`. */
async function unlockBits(
  po: PermissionOverwriteManager,
  guild: Guild,
  added: ArchivedOverwrites,
): Promise<void> {
  const flags: FlagName[] = [];
  if (added.everyoneSend) flags.push('SendMessages');
  if (added.everyoneView) flags.push('ViewChannel');
  await clearFlags(po, guild.id, flags, OverwriteType.Role);
  if (added.botView) {
    const botId = guild.client.user.id;
    await clearFlags(po, botId, ['ViewChannel'], OverwriteType.Member);
  }
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
 * Archive (D6): add the `@everyone` SendMessages deny (+ ViewChannel when
 * `hide`, with a bot ViewChannel allow) — only bits not already set — then
 * move under `categoryId`. A lock/move failure undoes the added bits before
 * rethrowing. A parent in `seriesIds` (the Archived series) is not a restore
 * target, so `restoreParentId` is null (→ Games).
 */
export async function archiveChannel(
  guild: Guild,
  channelId: string,
  opts: { categoryId: string; hide: boolean; seriesIds?: ReadonlySet<string> },
): Promise<ArchiveResult> {
  const channel = await resolveTextChannel(guild, channelId);
  const po = channel.permissionOverwrites;
  const previousParentId = channel.parentId;
  const added = bitsToAdd(po, guild, opts.hide);
  try {
    await lifecycleCall('archive.lock', channelId, () =>
      lockBits(po, guild, added),
    );
    await moveChannel(guild, 'archive.move', channelId, opts.categoryId);
  } catch (err) {
    await bestEffort(() => unlockBits(po, guild, added));
    throw err;
  }
  const inSeries =
    previousParentId !== null &&
    (opts.seriesIds?.has(previousParentId) ?? false);
  return {
    previousParentId,
    restoreParentId: inSeries ? null : previousParentId,
    added,
  };
}

/**
 * Undo a successful `archiveChannel` (its DB write failed): move back to the
 * previous parent and clear the added bits. Best effort — never throws.
 */
export async function revertArchive(
  guild: Guild,
  channelId: string,
  res: ArchiveResult,
): Promise<void> {
  await bestEffort(async () => {
    const channel = await resolveTextChannel(guild, channelId);
    await moveChannel(guild, 'archive.revert', channelId, res.previousParentId);
    await unlockBits(channel.permissionOverwrites, guild, res.added);
  });
}

/**
 * Unarchive (D6): move back to `parentId`, then clear exactly the bits the
 * archive recorded in `added` (null → the legacy send lock only).
 */
export async function unarchiveChannel(
  guild: Guild,
  channelId: string,
  opts: { parentId: string | null; added?: ArchivedOverwrites | null },
): Promise<void> {
  const channel = await resolveTextChannel(guild, channelId);
  await moveChannel(guild, 'unarchive.move', channelId, opts.parentId);
  const added = opts.added ?? LEGACY_ARCHIVED_OVERWRITES;
  await lifecycleCall('unarchive.unlock', channelId, () =>
    unlockBits(channel.permissionOverwrites, guild, added),
  );
}
