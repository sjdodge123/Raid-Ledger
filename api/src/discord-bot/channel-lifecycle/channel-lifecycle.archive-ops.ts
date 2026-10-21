/**
 * Archive / unarchive Discord ops for the game-channel lifecycle (ROK-1431,
 * spec ROK-1428 D6). The overwrite plan and its inverse live in
 * `channel-lifecycle.overwrites.ts`: archive records every bit it changes with
 * its prior state; unarchive (and a failed archive's rollback) restores those
 * priors against a fresh API read, so admin-made privacy survives and the bot
 * keeps posting into an archived channel.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Guild } from 'discord.js';
import { DISCORD_API_TIMEOUT_MS } from '../services/scheduled-event.helpers';
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

/** The raw parent edit (no overwrite sync); untimed — callers race it. */
function editParent(
  guild: Guild,
  channelId: string,
  parentId: string | null,
): Promise<unknown> {
  return guild.channels.edit(channelId, {
    parent: parentId,
    lockPermissions: false,
  });
}

/** Move a channel without syncing its overwrites to the new parent. */
async function moveChannel(
  guild: Guild,
  op: string,
  channelId: string,
  parentId: string | null,
): Promise<void> {
  await lifecycleCall(op, channelId, () =>
    editParent(guild, channelId, parentId),
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

const logger = new Logger('ChannelLifecycleArchive');

type Settled = 'fulfilled' | 'rejected' | 'pending';

/** Wait (bounded, 2x the call cap) for a raw Discord promise to settle. */
async function settleWithin(p: Promise<unknown>): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    p.then(
      (): Settled => 'fulfilled',
      (): Settled => 'rejected',
    ),
    new Promise<Settled>((resolve) => {
      timer = setTimeout(() => resolve('pending'), DISCORD_API_TIMEOUT_MS * 2);
    }),
  ]);
  clearTimeout(timer);
  return settled;
}

/** Log + report a lifecycle anomaly that leaves no saved record. */
function reportWarning(msg: string): void {
  logger.warn(msg);
  Sentry.captureMessage(msg, { level: 'warning' });
}

/**
 * Wait (bounded) for the lock's overwrite edits to settle. `timedDiscordCall`
 * rejecting does not stop `writeLock`, so a rollback that ran first would be
 * overwritten by the late edits (Codex r8 P1). A lock that never settles is
 * logged + reported: the channel may be left locked with no saved record.
 */
async function settleLock(
  lock: Promise<void>,
  channelId: string,
): Promise<void> {
  if ((await settleWithin(lock)) !== 'pending') return;
  reportWarning(
    `Archive lock edits on channel ${channelId} never settled; rollback may be overwritten`,
  );
}

/**
 * Codex r10 P2: a timed-out `archive.move` keeps running; a late success
 * leaves the channel under Archived with an active binding and no saved
 * parent. Move it back to `parentId` once it lands — awaited within the
 * bounded wait, else on its eventual success. Best effort; never rejects.
 */
async function compensateMove(
  guild: Guild,
  channelId: string,
  move: Promise<unknown> | undefined,
  parentId: string | null,
): Promise<void> {
  if (!move) return;
  const back = (): Promise<void> =>
    bestEffort(() =>
      moveChannel(guild, 'archive.move.revert', channelId, parentId),
    );
  const state = await settleWithin(move);
  if (state === 'rejected') return;
  reportWarning(
    `Archive move on channel ${channelId} landed after its timeout; moving it back`,
  );
  if (state === 'fulfilled') return back();
  void move.then(back, () => undefined);
}

/** The move target and the parent a failed move is compensated back to. */
interface MovePlan {
  categoryId: string;
  previousParentId: string | null;
}

/** Lock then move; a failure settles the lock + move and restores the priors. */
async function lockAndMove(
  guild: Guild,
  channelId: string,
  po: Parameters<typeof writeLock>[0],
  changes: ArchivedOverwriteChange[],
  plan: MovePlan,
): Promise<void> {
  // Keep the edit promises themselves: the timed wrapper only races them.
  const lock = writeLock(po, idsOf(guild), changes);
  const pending: { move?: Promise<unknown> } = {};
  try {
    await lifecycleCall('archive.lock', channelId, () => lock);
    const move = editParent(guild, channelId, plan.categoryId);
    pending.move = move;
    await lifecycleCall('archive.move', channelId, () => move);
  } catch (err) {
    await settleLock(lock, channelId);
    await compensateMove(guild, channelId, pending.move, plan.previousParentId);
    await bestEffort(() => restoreFresh(guild, channelId, changes));
    throw err;
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
  await lockAndMove(guild, channelId, po, changes, {
    categoryId: opts.categoryId,
    previousParentId,
  });
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
