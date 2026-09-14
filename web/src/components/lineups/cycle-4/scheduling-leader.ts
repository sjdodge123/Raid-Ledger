/**
 * Slot ordering + leader/tie derivation for the scheduling poll (ROK-1543).
 *
 * Layout B promotes the winning slot into a decision card, so "which slot is
 * leading" and "are the top two level" have to be answered in exactly ONE
 * place — the card, the ladder and the tests must never disagree.
 *
 * `sortSlots` is the web's current comparator (votes desc, then proposed time
 * asc). ROK-1548 replaces it with the shared comparator used by the Discord
 * embed: swap the body/import HERE and every consumer follows.
 */
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';

/** Sort slots by votes desc, then proposed time asc. Never mutates `slots`. */
export function sortSlots(
  slots: ScheduleSlotWithVotesDto[],
): ScheduleSlotWithVotesDto[] {
  return [...slots].sort(
    (a, b) =>
      b.votes.length - a.votes.length ||
      new Date(a.proposedTime).getTime() - new Date(b.proposedTime).getTime(),
  );
}

/** The slot currently winning the poll, plus whether the top two are level. */
export interface SchedulingLeader {
  /** The winning slot under {@link sortSlots}. */
  slot: ScheduleSlotWithVotesDto;
  /** Votes cast on the winning slot. */
  votes: number;
  /**
   * The runner-up has the same vote count, so the tiebreak (earliest time
   * wins) is what decides it. A 0-0 "tie" before anyone has voted is not a
   * tie — it is an empty poll, and the card says so instead.
   */
  tied: boolean;
}

/**
 * Derive the leading slot from an unsorted slot list.
 *
 * @returns the leader, or `null` when no times have been proposed.
 */
export function deriveSchedulingLeader(
  slots: ScheduleSlotWithVotesDto[],
): SchedulingLeader | null {
  const sorted = sortSlots(slots);
  const top = sorted[0];
  if (!top) return null;
  const votes = top.votes.length;
  const runnerUp = sorted[1];
  const tied = votes > 0 && runnerUp !== undefined && runnerUp.votes.length === votes;
  return { slot: top, votes, tied };
}
