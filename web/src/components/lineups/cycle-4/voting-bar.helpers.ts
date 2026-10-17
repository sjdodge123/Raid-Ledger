/**
 * Vote-bar percentage math (ROK-1298, Sv).
 *
 * Returns the rounded width percentage for a per-entry vote bar in the
 * Sv Voting composite. The denominator is the *voter pool* (i.e.
 * `votingEligibleCount`), NOT the count of users who have cast >=1 vote
 * (the legacy `totalVoters` bug that filled the bar at 100% on the very
 * first vote — observed 2026-05-15).
 *
 * Defensive: returns 0 for any non-positive denominator so a NaN never
 * reaches a `style.width` value, and clamps the result to [0, 100] so a
 * pathological `voteCount > votingEligibleCount` never overflows.
 *
 * @param voteCount - Number of votes cast for this entry.
 * @param votingEligibleCount - Total users eligible to vote on the lineup.
 * @returns Bar width as an integer percentage in [0, 100].
 */
export function voteBarPct(
  voteCount: number,
  votingEligibleCount: number,
): number {
  if (votingEligibleCount <= 0) return 0;
  const pct = Math.round((voteCount / votingEligibleCount) * 100);
  return Math.max(0, Math.min(100, pct));
}
