import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ReconcileResultDto } from '@raid-ledger/contract';
import { applyAction } from './channel-lifecycle.apply';
import {
  ChannelGoneError,
  CreateCapacityError,
  LifecyclePermissionError,
} from './channel-lifecycle.errors';
import {
  CAP_DETAIL,
  emptyResult,
  tally,
  type ReconcilePlan,
} from './channel-lifecycle.plan';
import { insertSuppression } from './channel-lifecycle.store';
import { unlinkAutoHubsForChannel } from './hub-channel-link.queries';
import type {
  ApplyContext,
  ItemOutcome,
  PlannedGame,
} from './channel-lifecycle.types';

/**
 * ROK-1431 — the live reconcile loop + the D14 error policy (spec §2.5 steps
 * 6–7, §2.9): one game's failure never blocks the others; a permission error
 * stops the tick; a hand-deleted channel is unbound + suppressed, no Sentry.
 */

const logger = new Logger('ChannelLifecycleRun');

/** The `lastRunError` text for a permission stop (§2.5 step 7). */
export const PERMISSION_ERROR_TEXT =
  'Raid Ledger needs Manage Channels and Manage Roles';

/** `lastRunError` when no archive category can be found or created. */
export const NO_ARCHIVE_CATEGORY_TEXT =
  'Choose or allow an Archived category before enabling';

/** The `lastRunError` a finished tick records (null = clean, clears it). */
export function runErrorText(result: ReconcileResultDto): string | null {
  if (result.stoppedReason === 'permissions') return PERMISSION_ERROR_TEXT;
  if (result.stoppedReason === 'no-archive-category') {
    return NO_ARCHIVE_CATEGORY_TEXT;
  }
  return null;
}

/**
 * D9: the channel is gone — suppress first (so it reads `deleted`), unbind,
 * and clear hubs auto-linked to it (manual hub links are untouched).
 */
async function handleGone(
  ctx: ApplyContext,
  game: PlannedGame,
): Promise<ItemOutcome> {
  const { binding, gameId } = game.row;
  await insertSuppression(ctx.db, {
    guildId: ctx.guild.id,
    gameId,
    reason: 'deleted',
  });
  if (binding) {
    // On the lock's tx (int-fix 3): a pool unbind re-inserts the suppression on
    // a second connection, which waits on the tx's uncommitted row → deadlock.
    await ctx.bindings.unbindById(binding.id, { db: ctx.db });
    await unlinkAutoHubsForChannel(ctx.db, binding.channelId);
  }
  return { outcome: 'failed', detail: 'channel deleted in Discord' };
}

/** Map one game's thrown error onto an outcome (D14). */
async function handleFailure(
  ctx: ApplyContext,
  game: PlannedGame,
  err: unknown,
): Promise<ItemOutcome> {
  if (err instanceof LifecyclePermissionError) {
    return { outcome: 'failed', detail: err.message, stop: true };
  }
  if (err instanceof CreateCapacityError) {
    return { outcome: 'failed', detail: err.message, stopCreates: true };
  }
  if (err instanceof ChannelGoneError) return handleGone(ctx, game);
  const phase = game.action === 'link_hub' ? 'link' : game.action;
  Sentry.captureException(err, {
    tags: { area: `channel-lifecycle-${phase}` },
    extra: { gameId: game.row.gameId },
  });
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(
    `Lifecycle ${game.action} failed for ${game.row.gameId}: ${message}`,
  );
  return { outcome: 'failed', detail: message };
}

/** Run one game, never throwing (per-game isolation). */
async function runOne(
  ctx: ApplyContext,
  game: PlannedGame,
): Promise<ItemOutcome> {
  try {
    return await applyAction(ctx, game);
  } catch (err) {
    try {
      return await handleFailure(ctx, game, err);
    } catch (inner) {
      Sentry.captureException(inner, {
        tags: { area: 'channel-lifecycle-cleanup' },
      });
      return { outcome: 'failed', detail: 'cleanup failed' };
    }
  }
}

/** Detail for creates deferred after the guild hit its channel cap. */
export const CAPACITY_DETAIL = 'deferred: server channel limit reached';

/** §2.13: the guild is full — ONE Sentry message per tick. */
function reportCapacity(): void {
  Sentry.captureMessage('Channel lifecycle: server channel limit reached', {
    level: 'warning',
    tags: { area: 'channel-lifecycle-create' },
  });
}

/**
 * Run the plan's items in order. A permission error stops the tick (returns
 * the not-yet-run items); a full guild (30013) defers the remaining creates.
 */
async function runItems(
  ctx: ApplyContext,
  run: readonly PlannedGame[],
  result: ReconcileResultDto,
): Promise<PlannedGame[]> {
  const waiting = [...run];
  let capped = false;
  for (let game = waiting.shift(); game; game = waiting.shift()) {
    if (capped && game.action === 'create') {
      tally(result, game, { outcome: 'deferred', detail: CAPACITY_DETAIL });
      continue;
    }
    const item = await runOne(ctx, game);
    tally(result, game, item);
    if (item.stop) {
      result.stoppedReason = 'permissions';
      break;
    }
    if (item.stopCreates && !capped) reportCapacity();
    capped ||= item.stopCreates === true;
  }
  return waiting;
}

/**
 * Execute a plan live; returns the tally (stoppedReason set on a permission
 * stop — the caller sends the D14 Sentry message, deduped across nudges).
 */
export async function executePlan(
  ctx: ApplyContext,
  plan: ReconcilePlan,
): Promise<ReconcileResultDto> {
  const result = emptyResult(false, null);
  result.skipped = plan.skipped;
  const waiting = await runItems(ctx, plan.run, result);
  const stopped = 'stopped: missing permissions';
  for (const g of waiting)
    tally(result, g, { outcome: 'deferred', detail: stopped });
  for (const g of plan.deferred) {
    tally(result, g, { outcome: 'deferred', detail: CAP_DETAIL });
  }
  return result;
}
