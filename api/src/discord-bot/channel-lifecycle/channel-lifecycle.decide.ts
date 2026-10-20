import type {
  ChannelLifecycleSettingsDto,
  LifecycleAction,
} from '@raid-ledger/contract';
import type { GameLifecycleActivityRow } from './game-activity.queries';

/**
 * ROK-1430 — the pure lifecycle decision (spec §2.4 X1–X12, D3/D4).
 *
 * Asymmetric bar (D4): create needs `createThreshold` items or a hub hold;
 * keep / unarchive needs ≥ 1 item or a hold; archive needs 0 items, no hold,
 * not pinned. Manual bindings are never archived or unarchived. X11 / X12 are
 * enforced by the query (series and non-game bindings are never candidates).
 */

/** The slice of a derived activity row the decision reads. */
export type DecideGameInput = Pick<
  GameLifecycleActivityRow,
  'itemCount' | 'hubHold' | 'hubNeedsLink' | 'suppressed' | 'binding'
>;

/** The settings the decision reads. */
export type DecideSettings = Pick<
  ChannelLifecycleSettingsDto,
  'createThreshold' | 'recentActivityDays'
>;

/** What to do for one game, and why (shown in the admin activity list). */
export interface LifecycleDecision {
  action: LifecycleAction;
  reason: string;
}

/** X1–X4: the game has no candidate binding. */
function decideUnbound(
  row: DecideGameInput,
  settings: DecideSettings,
): LifecycleDecision {
  const { itemCount } = row;
  const threshold = settings.createThreshold;
  if (row.suppressed) return { action: 'none', reason: 'suppressed' };
  if (itemCount >= threshold) {
    return { action: 'create', reason: `${itemCount} activities in window` };
  }
  if (row.hubHold) return { action: 'create', reason: 'active community hub' };
  return { action: 'none', reason: `${itemCount} of ${threshold} activities` };
}

/** The `none` outcome for a live channel, upgraded to `link_hub` when a hub has no channel (D7). */
function keepOrLink(row: DecideGameInput, reason: string): LifecycleDecision {
  if (row.hubNeedsLink)
    return { action: 'link_hub', reason: 'hub has no channel' };
  return { action: 'none', reason };
}

/**
 * Decides the lifecycle action for one game.
 *
 * @param row - the derived activity row (`selectGameLifecycleActivity`)
 * @param settings - `createThreshold` and the window length (for reasons)
 * @returns the action and a human-readable reason
 */
export function decideGame(
  row: DecideGameInput,
  settings: DecideSettings,
): LifecycleDecision {
  const { binding } = row;
  if (!binding) return decideUnbound(row, settings);
  if (!binding.autoManaged) return keepOrLink(row, 'manual binding');
  if (binding.pinned) return { action: 'none', reason: 'pinned' };
  const live = row.itemCount >= 1 || row.hubHold;
  if (binding.lifecycleState === 'archived') {
    return live
      ? { action: 'unarchive', reason: 'activity resumed' }
      : { action: 'none', reason: 'archived, still quiet' };
  }
  if (live) return keepOrLink(row, 'active');
  const days = settings.recentActivityDays;
  return { action: 'archive', reason: `no activity in ${days} days` };
}
