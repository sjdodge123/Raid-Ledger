/**
 * Catch-up line for a member who joined the poll after voting started
 * (ROK-1545 AC5, audit F-05 / P-6 — Layout C's catch-up folded into Layout B).
 *
 * One sentence, directly above the ladder: what is currently ahead, how many
 * members have already answered, and how long is left. It is purely
 * presentational — `deriveCatchUp` in `scheduling-catch-up.ts` decides whether
 * the viewer is late at all.
 */
import type { JSX } from 'react';
import type { SchedulingCatchUp } from './scheduling-catch-up';

export interface SchedulingCatchUpLineProps {
  catchUp: SchedulingCatchUp;
  /** Formatted leading slot time, or null when nothing leads yet. */
  leaderLabel: string | null;
  /** Relative deadline copy (e.g. "closes in 2 days"), or null when none. */
  deadlineLabel: string | null;
}

/** Late-joiner catch-up line — see file-level docstring. */
export function SchedulingCatchUpLine(
  props: SchedulingCatchUpLineProps,
): JSX.Element {
  const { catchUp, leaderLabel, deadlineLabel } = props;
  return (
    <p
      data-testid="scheduling-catch-up"
      className="rounded-lg border border-edge bg-panel/40 p-3 text-sm text-secondary"
    >
      <span className="font-medium text-foreground">
        You joined late — here is where the poll is.
      </span>{' '}
      {leaderLabel ? (
        <>
          <span className="text-foreground">{leaderLabel}</span> is ahead
        </>
      ) : (
        <>No time is ahead yet</>
      )}
      {', '}
      <span className="text-foreground">
        {catchUp.votersSoFar} of {catchUp.memberCount}
      </span>{' '}
      {catchUp.memberCount === 1 ? 'member has' : 'members have'} voted
      {deadlineLabel ? ` — ${deadlineLabel}.` : '.'}
    </p>
  );
}
