/**
 * Pure helpers for scheduling poll embed data (ROK-1014).
 */
import type { ScheduleVoteRow } from './scheduling-query.helpers';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';

interface SlotRow {
  id: number;
  proposedTime: Date;
}

/** Everything needed to place a poll on the lifecycle (ROK-1545). */
export interface PollLifecycleInput {
  /** `community_lineup_matches.status`. */
  matchStatus: string | null | undefined;
  /** `community_lineups.status` — `archived` once the phase job runs. */
  lineupStatus?: string | null;
  /** `community_lineups.phase_deadline`. */
  phaseDeadline?: Date | string | null;
  /** The event a lock-in produced, when there is one. */
  linkedEventId?: number | null;
  /**
   * ROK-1607: every slot's `proposed_time`. Omit when the caller has not
   * loaded the slots — the check is then skipped rather than guessed.
   */
  slotTimes?: ReadonlyArray<Date | string | null | undefined>;
  /** Injectable clock for tests. */
  now?: Date;
}

/** True when the poll's window has shut (phase job archived it, or deadline). */
function windowHasShut(input: PollLifecycleInput): boolean {
  if (input.lineupStatus === 'archived') return true;
  if (!input.phaseDeadline) return false;
  const deadline = new Date(input.phaseDeadline).getTime();
  if (Number.isNaN(deadline)) return false;
  return deadline <= (input.now ?? new Date()).getTime();
}

/**
 * ROK-1607: true when the poll HAS slots and not one of them is still in the
 * future. A poll with no slots yet stays open — nothing has passed, and the
 * whole point of it is that someone still suggests a time. Unparseable times
 * are ignored rather than counted as past (a bad row must not close a poll).
 */
function everySlotHasPassed(input: PollLifecycleInput): boolean {
  if (!input.slotTimes) return false;
  const now = (input.now ?? new Date()).getTime();
  let seen = 0;
  for (const raw of input.slotTimes) {
    if (raw === null || raw === undefined) continue;
    const at = new Date(raw).getTime();
    if (Number.isNaN(at)) continue;
    seen += 1;
    if (at > now) return false;
  }
  return seen > 0;
}

/**
 * Place a poll on the four-state lifecycle both the Discord embed and the web
 * poll page render (ROK-1461, extended by ROK-1545). ONE function so the two
 * surfaces can never disagree (audit F-01/F-02/F-04):
 *   - `scheduled` → `locked_in`
 *   - `archived` match → `cancelled` (an operator ended it; the reason is on
 *     the match row)
 *   - still `suggested`/`scheduling` but the window has shut and no event was
 *     created → `closed`, i.e. EXPIRED. This case is only visible by reading
 *     the lineup alongside the match: the lineup-phase job archives the
 *     LINEUP and leaves the match on `scheduling` (prod match 49 / lineup 26).
 *   - ROK-1607: every proposed time already passed → `closed` too, whatever
 *     the deadline says. There is nothing left to vote for, so a card reading
 *     POLL OPEN for another 72h just collects clicks on dead times.
 *   - anything else → `open`
 *
 * @param input - The match row, plus the parent lineup's status/deadline.
 * @returns The status both surfaces render.
 */
export function pollStatusFromMatch(
  input: PollLifecycleInput,
): SchedulingPollStatus {
  if (input.matchStatus === 'scheduled') return 'locked_in';
  if (input.matchStatus === 'archived') return 'cancelled';
  // A match that already produced an event is never "expired" — the lock-in
  // won, whatever the phase job did to the parent lineup afterwards.
  if (input.linkedEventId) return 'open';
  return windowHasShut(input) || everySlotHasPassed(input) ? 'closed' : 'open';
}

/** Build the poll URL for the vote link. */
export function buildPollUrl(
  clientUrl: string,
  lineupId: number,
  matchId: number,
): string {
  return `${clientUrl}/community-lineup/${lineupId}/schedule/${matchId}`;
}

/** Convert slot + vote rows into the embed slot format. */
export function buildEmbedSlots(slots: SlotRow[], votes: ScheduleVoteRow[]) {
  return slots.map((slot) => {
    const slotVotes = votes.filter((v) => v.slotId === slot.id);
    return {
      id: slot.id,
      proposedTime: slot.proposedTime.toISOString(),
      voteCount: slotVotes.length,
      voterNames: slotVotes.map((v) => v.displayName),
    };
  });
}
