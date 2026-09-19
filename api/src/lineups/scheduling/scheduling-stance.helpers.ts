/**
 * The stance transition rule for a schedule-slot vote (ROK-1617 AC2).
 *
 * Three states per member per slot — yes / no / not answered — collapsed onto
 * ONE row by `uq_schedule_vote_user`: a stance is the row's `stance` column
 * and "not answered" is no row at all. That makes every transition one of
 * three DB shapes, which is what `resolveStanceAction` names.
 *
 * Pure on purpose: the interesting behaviour (a misclick being recoverable) is
 * a decision, not a query, so it is unit-testable without a database.
 */
import type { ScheduleVoteStance } from '@raid-ledger/contract';

/** What the toggle should do to the (slot, user) row. */
export type StanceAction =
  /** No row existed — the INSERT already stored `stance`. */
  | { kind: 'inserted'; stance: ScheduleVoteStance }
  /** A row existed with the OTHER stance — UPDATE it in place. */
  | { kind: 'changed'; stance: ScheduleVoteStance }
  /** The same stance was pressed twice — DELETE, back to not answered. */
  | { kind: 'cleared'; stance: null };

/**
 * Decide the transition from the row that was (or was not) already there.
 *
 * Pressing the same stance twice clears it, which is the whole recoverability
 * story: a member who mis-taps "doesn't work" taps it again and is back to
 * not-answered rather than being stranded on a `no` they did not mean. That
 * also preserves the pre-ROK-1617 behaviour exactly for a yes-only client —
 * tap, tap again, gone.
 *
 * @param existing - The stance already on record, or null when no row exists.
 * @param requested - The stance the member just pressed.
 * @returns The action the caller should perform, and the resulting stance.
 */
export function resolveStanceAction(
  existing: ScheduleVoteStance | null,
  requested: ScheduleVoteStance,
): StanceAction {
  if (existing === null) return { kind: 'inserted', stance: requested };
  if (existing === requested) return { kind: 'cleared', stance: null };
  return { kind: 'changed', stance: requested };
}

/**
 * Whether an action puts an ANSWER on record (as opposed to removing one).
 *
 * The votability guard keys off this: casting or changing a stance on a slot
 * whose time has already passed is refused, while CLEARING one is always
 * allowed — otherwise a member who voted for Friday could never untick it on
 * Saturday (the ROK-1607 narrowing, extended to cover `no`).
 *
 * @param action - The resolved transition.
 * @returns True for an insert or a stance change.
 */
export function isAnswering(action: StanceAction): boolean {
  return action.kind !== 'cleared';
}
