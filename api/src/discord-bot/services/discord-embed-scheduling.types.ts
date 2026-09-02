/**
 * Types for scheduling poll Discord embeds (ROK-1014).
 */

/** Slot data for a scheduling poll embed. */
export interface SchedulingPollSlot {
  proposedTime: string;
  voteCount: number;
  voterNames: string[];
}

/**
 * Lifecycle of a scheduling poll as the EMBED renders it (ROK-1461).
 *
 * Collapsed from `community_lineup_matches.status`
 * (suggested | scheduling → `open`, scheduled → `locked_in`,
 * archived → `closed`) by `pollStatusFromMatch`.
 */
export type SchedulingPollStatus = 'open' | 'locked_in' | 'closed';

/** Input data for building a scheduling poll embed. */
export interface SchedulingPollEmbedData {
  matchId: number;
  lineupId: number;
  /** ROK-1461: links the title to `/games/:id`. */
  gameId?: number;
  gameName: string;
  gameCoverUrl?: string | null;
  pollUrl: string;
  /** ROK-1461: drives the author line and the colour. Defaults to `open`. */
  status?: SchedulingPollStatus;
  /**
   * ROK-1461: ISO start time the lock-in actually selected (the linked event's
   * start). Lock-in is NOT required to pick the top-voted slot, so the card
   * must announce this rather than re-deriving a winner from the votes.
   */
  lockedInTime?: string | null;
  slots: SchedulingPollSlot[];
  uniqueVoterCount: number;
}
