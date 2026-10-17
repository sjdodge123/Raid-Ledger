/**
 * Voting-eligibility helper (ROK-1298).
 *
 * Pure function that returns the number of users *eligible* to vote on a
 * lineup. Used as the denominator for normalized vote bars in the Sv
 * Voting composite, replacing the legacy `totalVoters` denominator (which
 * only counted users who had cast >=1 vote and produced the "1 vote =
 * 100% bar" regression observed 2026-05-15).
 *
 * Branches:
 *   - private: 1 (creator) + invitees, deduping the creator if present.
 *   - public: `totalMembers` (the lineup audience IS the whole community).
 *
 * Guard: result is floored at 1 — the creator is always eligible.
 */

interface LineupShape {
  /** ID of the user who created the lineup. */
  createdBy: number;
  /** Lineup visibility. */
  visibility: 'public' | 'private';
}

interface InviteeShape {
  id: number;
}

/**
 * Compute the number of users eligible to vote on a lineup.
 *
 * @param lineup - Lineup metadata (creator id + visibility).
 * @param invitees - Invitee rows for the lineup (private only — ignored for public).
 * @param totalMembers - Membership count (public only — ignored for private).
 * @returns Voter-pool size. Always >= 1.
 */
export function computeVotingEligibleCount(
  lineup: LineupShape,
  invitees: InviteeShape[],
  totalMembers: number,
): number {
  if (lineup.visibility === 'private') {
    const nonCreatorInvitees = invitees.filter(
      (i) => i.id !== lineup.createdBy,
    ).length;
    return Math.max(1, 1 + nonCreatorInvitees);
  }
  return Math.max(1, totalMembers);
}
