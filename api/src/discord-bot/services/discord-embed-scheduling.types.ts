/**
 * Types for scheduling poll Discord embeds (ROK-1014).
 */

/** Slot data for a scheduling poll embed. */
export interface SchedulingPollSlot {
  proposedTime: string;
  voteCount: number;
  voterNames: string[];
}

/** Input data for building a scheduling poll embed. */
export interface SchedulingPollEmbedData {
  matchId: number;
  lineupId: number;
  gameName: string;
  gameCoverUrl?: string | null;
  pollUrl: string;
  slots: SchedulingPollSlot[];
  uniqueVoterCount: number;
}
