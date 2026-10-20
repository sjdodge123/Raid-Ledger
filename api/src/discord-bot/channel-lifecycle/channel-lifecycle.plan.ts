import type {
  ChannelLifecycleSettingsDto,
  LifecycleAction,
  ReconcileResultDto,
} from '@raid-ledger/contract';
import { decideGame } from './channel-lifecycle.decide';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { ItemOutcome, PlannedGame } from './channel-lifecycle.types';

/** ROK-1431 — pure planning + result tallying for a reconcile (§2.5, D13). */

type StopReason = ReconcileResultDto['stoppedReason'];

/** A tick's plan: what runs now, what waits for the cap, how many were `none`. */
export interface ReconcilePlan {
  run: PlannedGame[];
  deferred: PlannedGame[];
  skipped: number;
}

/** D13 order: creates first, then unarchive, then archive. */
const CAPPED_ORDER: readonly LifecycleAction[] = [
  'create',
  'unarchive',
  'archive',
];

/** Detail for a game the per-tick cap pushed to the next tick. */
export const CAP_DETAIL = 'max changes per tick reached';

/**
 * Decide every row, order the channel changes (D13) and cap them at
 * `maxChangesPerTick`; `link_hub` touches no channel so it is never capped.
 */
export function planReconcile(
  rows: readonly GameLifecycleActivityRow[],
  settings: ChannelLifecycleSettingsDto,
): ReconcilePlan {
  const decided = rows.map((row) => ({ row, ...decideGame(row, settings) }));
  const capped = CAPPED_ORDER.flatMap((a) =>
    decided.filter((g) => g.action === a),
  );
  const links = decided.filter((g) => g.action === 'link_hub');
  const cap = settings.maxChangesPerTick;
  return {
    run: [...capped.slice(0, cap), ...links],
    deferred: capped.slice(cap),
    skipped: decided.filter((g) => g.action === 'none').length,
  };
}

/** A result with no items (gates, or the start of a tally). */
export function emptyResult(
  dryRun: boolean,
  stoppedReason: StopReason,
): ReconcileResultDto {
  return {
    dryRun,
    created: 0,
    unarchived: 0,
    archived: 0,
    linkedHubs: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    stoppedReason,
    items: [],
  };
}

/** Bump the action counter for a done (or, in a dry run, planned) item. */
function countAction(
  result: ReconcileResultDto,
  action: LifecycleAction,
): void {
  if (action === 'create') result.created += 1;
  if (action === 'unarchive') result.unarchived += 1;
  if (action === 'archive') result.archived += 1;
}

/** Record one game's outcome on the result (mutates `result`). */
export function tally(
  result: ReconcileResultDto,
  game: PlannedGame,
  item: ItemOutcome,
): void {
  result.items.push({
    gameId: game.row.gameId,
    gameName: game.row.gameName,
    action: game.action,
    outcome: item.outcome,
    detail: item.detail,
  });
  if (item.outcome === 'failed') result.failed += 1;
  if (item.outcome === 'deferred') result.deferred += 1;
  if (item.outcome === 'done' || item.outcome === 'planned') {
    if (game.action !== 'link_hub') countAction(result, game.action);
  }
  result.linkedHubs += item.linkedHubs ?? 0;
}

/** A dry run: every capped item `planned`, the overflow `deferred`, no writes. */
export function plannedResult(plan: ReconcilePlan): ReconcileResultDto {
  const result = emptyResult(true, null);
  result.skipped = plan.skipped;
  for (const g of plan.run) {
    tally(result, g, { outcome: 'planned', detail: g.reason });
    if (g.action === 'link_hub') result.linkedHubs += 1;
  }
  for (const g of plan.deferred) {
    tally(result, g, { outcome: 'deferred', detail: CAP_DETAIL });
  }
  return result;
}
