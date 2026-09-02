/**
 * Pure helpers for scheduling poll embed data (ROK-1014).
 */
import type { ScheduleVoteRow } from './scheduling-query.helpers';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';

interface SlotRow {
  id: number;
  proposedTime: Date;
}

/**
 * Map `community_lineup_matches.status` onto the embed's three-state grammar
 * (ROK-1461). A match that is still gathering times — `suggested` or
 * `scheduling` — reads as `open`; `scheduled` is the lock-in; `archived` (and
 * anything unknown) is a closed poll.
 *
 * @param status - The DB status of the match row.
 * @returns The status the embed renders.
 */
export function pollStatusFromMatch(
  status: string | null | undefined,
): SchedulingPollStatus {
  if (status === 'scheduled') return 'locked_in';
  if (status === 'archived') return 'closed';
  return 'open';
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
      proposedTime: slot.proposedTime.toISOString(),
      voteCount: slotVotes.length,
      voterNames: slotVotes.map((v) => v.displayName),
    };
  });
}
