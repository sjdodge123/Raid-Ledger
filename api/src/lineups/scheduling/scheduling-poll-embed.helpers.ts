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
  return windowHasShut(input) ? 'closed' : 'open';
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
