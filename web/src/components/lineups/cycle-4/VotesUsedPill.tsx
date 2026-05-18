/**
 * "X of N votes used" status pill (ROK-1298, Sv).
 *
 * Sits above the leaderboard so the running vote-tally is visible without
 * the user having to scan the SubmitBar. Non-interactive, but uses
 * `role="status"` + `aria-live="polite"` so screen readers announce the
 * running count as the user toggles votes (spec §Accessibility).
 */
import type { JSX } from 'react';

/** Props for {@link VotesUsedPill}. */
export interface VotesUsedPillProps {
  /** Votes the viewer has cast so far. */
  used: number;
  /** Maximum votes the viewer is allowed to cast (per-lineup config). */
  max: number;
}

/** "X of N votes used" status pill — see file-level docstring. */
export function VotesUsedPill(props: VotesUsedPillProps): JSX.Element {
  const { used, max } = props;
  return (
    <div
      data-testid="votes-used-pill"
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-edge bg-overlay/40 text-[11px] text-muted"
    >
      {used} of {max} votes used
    </div>
  );
}
