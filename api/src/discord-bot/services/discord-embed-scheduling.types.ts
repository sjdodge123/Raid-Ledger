/**
 * Types for scheduling poll Discord embeds (ROK-1014).
 */

/** Slot data for a scheduling poll embed. */
export interface SchedulingPollSlot {
  /** ROK-1548: the tie-break of last resort in the shared comparator. */
  id: number;
  proposedTime: string;
  /** YES votes only (ROK-1617) — what the card renders as "N votes". */
  voteCount: number;
  /**
   * ROK-1617: NO votes. Optional so a fixture predating the stance column
   * still type-checks and orders exactly as it did before.
   */
  noCount?: number;
  voterNames: string[];
}

/**
 * Lifecycle of a scheduling poll as the EMBED renders it (ROK-1461).
 *
 * Collapsed from `community_lineup_matches.status`
 * (suggested | scheduling → `open`, scheduled → `locked_in`, archived →
 * `cancelled`, window shut with no lock-in → `closed`) by
 * `pollStatusFromMatch`. ROK-1545 split `cancelled` out of `closed` so the
 * web page can say WHICH ending happened; the embed copy follows in ROK-1549.
 */
export type SchedulingPollStatus =
  'open' | 'locked_in' | 'cancelled' | 'closed';

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
  /** ROK-1549 AC3 (F-04): ISO poll deadline (`community_lineups.phase_deadline`). */
  deadline?: string | null;
  /** ROK-1549 AC3 (F-02): persisted cancellation reason, shown on a cancelled card. */
  cancelReason?: string | null;
  slots: SchedulingPollSlot[];
  uniqueVoterCount: number;
}
