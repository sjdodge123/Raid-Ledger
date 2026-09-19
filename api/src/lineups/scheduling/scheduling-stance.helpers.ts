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

/** The only fields a stance tally reads off a vote row. */
export interface StanceVoteRef {
  slotId: number;
  /** Absent means `'yes'` — the column default, and every pre-stance row. */
  stance?: ScheduleVoteStance | null;
}

/**
 * Drop the anti-votes from a vote list (ROK-1617).
 *
 * Every consumer that acts ON BEHALF of a voter — auto-signup, auto-heart,
 * the "nobody voted for that time" guard, the standalone poll's DM split —
 * used to be able to assume a row meant support. Once a `no` row lives in the
 * same table, "is there a row?" rosters the people who rejected the time. One
 * shared filter, so a new call site cannot re-derive it slightly differently.
 *
 * @param votes - Vote rows in any stance mix.
 * @returns Only the rows whose stance is (or defaults to) `'yes'`.
 */
export function yesVotesOnly<T extends { stance?: ScheduleVoteStance | null }>(
  votes: readonly T[],
): T[] {
  return votes.filter((vote) => (vote.stance ?? 'yes') === 'yes');
}

/** Yes/no counts for one slot, in the shape the shared comparator orders. */
export interface SlotStanceTally {
  /** YES votes. Never the raw row count of a mixed-stance list. */
  voteCount: number;
  /** NO votes — what the net score subtracts (ROK-1617 AC3). */
  noCount: number;
}

/** A slot nobody answered. */
const NO_ANSWERS: SlotStanceTally = { voteCount: 0, noCount: 0 };

/**
 * Split vote rows into per-slot yes/no counts (ROK-1617 AC3).
 *
 * Every ordering call site used to do `counts.get(slotId) + 1` over a raw vote
 * list. Once `no` rows share that table, that arithmetic counts a `no` as a
 * vote FOR the slot — the exact inversion the anti-vote exists to prevent. One
 * tally, used by every call site, is how that cannot drift back.
 *
 * @param votes - Vote rows across any number of slots.
 * @returns Slot id to its yes/no counts. Slots with no rows are absent.
 */
export function tallyStancesBySlot(
  votes: readonly StanceVoteRef[],
): Map<number, SlotStanceTally> {
  const tallies = new Map<number, SlotStanceTally>();
  for (const vote of votes) {
    const tally = tallies.get(vote.slotId) ?? { voteCount: 0, noCount: 0 };
    if ((vote.stance ?? 'yes') === 'no') tally.noCount += 1;
    else tally.voteCount += 1;
    tallies.set(vote.slotId, tally);
  }
  return tallies;
}

/**
 * One slot's tally, defaulting an unanswered slot to zeroes.
 *
 * @param tallies - Output of {@link tallyStancesBySlot}.
 * @param slotId - The slot to read.
 * @returns Its counts, or `{ voteCount: 0, noCount: 0 }`.
 */
export function stanceTallyFor(
  tallies: ReadonlyMap<number, SlotStanceTally>,
  slotId: number,
): SlotStanceTally {
  return tallies.get(slotId) ?? NO_ANSWERS;
}
