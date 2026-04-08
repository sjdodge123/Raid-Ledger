/**
 * Pure helpers for scheduling poll embed data (ROK-1014).
 */
import type { ScheduleVoteRow } from './scheduling-query.helpers';

interface SlotRow {
  id: number;
  proposedTime: Date;
}

/** Build the poll URL for the "Vote Now" button. */
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
