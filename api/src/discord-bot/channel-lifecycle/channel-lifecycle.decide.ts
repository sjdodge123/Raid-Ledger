import type {
  ChannelLifecycleSettingsDto,
  LifecycleAction,
} from '@raid-ledger/contract';
import type { GameLifecycleActivityRow } from './game-activity.queries';
import type { LockedBindingState } from './channel-lifecycle.store.queries';
import type { LifecycleCandidateBinding } from './game-activity.types';

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

/** Why a shared channel is not archived (plan + apply use the same words). */
export function sharedChannelDetail(n: number): string {
  return `shared with ${n} other binding${n === 1 ? '' : 's'}`;
}

type PlannedRoute = Pick<LifecycleCandidateBinding, 'channelId'> & {
  gameId: number;
};

/** Why a locked binding no longer routes to the planned game's channel. */
function staleRouteDetail(
  planned: PlannedRoute,
  current: LockedBindingState | null,
): string | null {
  if (!current) return 'skipped: binding removed since the read';
  if (current.gameId !== planned.gameId)
    return 'skipped: reassigned to another game';
  if (
    current.bindingPurpose !== 'game-announcements' ||
    current.recurrenceGroupId !== null
  )
    return 'skipped: purpose changed since the read';
  if (current.channelId !== planned.channelId)
    return 'skipped: channel changed since the read';
  return null;
}

/**
 * Codex r11 P2: why a `link_hub` planned from the snapshot is stale — the
 * binding was removed, re-pointed or re-routed since the read. Manual and
 * pinned bindings still link, so only the routing is re-checked.
 */
export function staleLinkDetail(
  planned: PlannedRoute,
  current: LockedBindingState | null,
): string | null {
  return staleRouteDetail(planned, current);
}

/**
 * Codex r9 P2: why a binding re-read (row-locked) at apply time no longer
 * qualifies for the planned archive / unarchive, or null when it still does.
 * Codex r10 P2: a binding re-routed to another game / purpose / series since
 * the read is judged on activity that is no longer its own — skip it too.
 */
export function staleBindingDetail(
  planned: PlannedRoute & Pick<LifecycleCandidateBinding, 'lifecycleState'>,
  current: LockedBindingState | null,
): string | null {
  const route = staleRouteDetail(planned, current);
  if (route !== null || !current) return route;
  if (current.pinned) return 'skipped: pinned since the read';
  if (!current.autoManaged) return 'skipped: no longer auto-managed';
  if (current.lifecycleState !== planned.lifecycleState)
    return 'skipped: state changed since the read';
  return null;
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
  // Codex r16 P2: a pin blocks archive / unarchive only — a pinned live
  // channel still links a hub that became eligible after the pin.
  if (binding.pinned) {
    return binding.lifecycleState === 'archived'
      ? { action: 'none', reason: 'pinned' }
      : keepOrLink(row, 'pinned');
  }
  const live = row.itemCount >= 1 || row.hubHold;
  if (binding.lifecycleState === 'archived') {
    return live
      ? { action: 'unarchive', reason: 'activity resumed' }
      : { action: 'none', reason: 'archived, still quiet' };
  }
  if (live) return keepOrLink(row, 'active');
  const shared = binding.sharedWith ?? 0;
  if (shared > 0)
    return { action: 'none', reason: sharedChannelDetail(shared) };
  const days = settings.recentActivityDays;
  return { action: 'archive', reason: `no activity in ${days} days` };
}
