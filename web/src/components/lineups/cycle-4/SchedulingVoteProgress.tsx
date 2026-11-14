/**
 * Compact vote-progress bar for the ROK-1300 Scheduling composite hero.
 *
 * Re-adds the ROK-1015/ROK-1121 progress bar that lived on the old
 * MatchContextCard (dropped when the composite replaced it). Renders ONLY when
 * the match has a `minVoteThreshold` set (null/absent → returns null, matching
 * the legacy MatchContextCard gate + the threshold smoke specs). Reuses the
 * exact `vote-progress-text` / `vote-progress-bar` testids + "X/Y voted" markup
 * so `scheduling-poll-threshold.smoke.spec.ts` (AC5) passes unchanged.
 *
 * `voted` = distinct voters so far (`poll.uniqueVoterCount`), `total` =
 * `match.minVoteThreshold`. The copy says "vote target", never "majority"
 * (see {@link targetCopy}).
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';

export interface SchedulingVoteProgressProps {
  match: MatchDetailResponseDto;
  /** Distinct voters on this poll so far (poll.uniqueVoterCount). */
  uniqueVoterCount: number | undefined;
}

/**
 * Right-hand copy. This bar counts poll PARTICIPATION (anyone who voted on any
 * time), not support for one time, so it never says "majority" — the lock-in
 * confirm owns that word and measures the picked slot against a majority of
 * members. Saying "Majority reached" here while that confirm said "below
 * majority?" for the same poll read as a contradiction (#2132 verify lane).
 */
function targetCopy(voted: number, total: number): string {
  if (voted >= total) return 'Vote target reached';
  const left = total - voted;
  return `${left} more ${left === 1 ? 'voter' : 'voters'} to reach the vote target`;
}

/** Compact distinct-voters / threshold progress bar — see file-level docstring. */
export function SchedulingVoteProgress(
  props: SchedulingVoteProgressProps,
): JSX.Element | null {
  const { match, uniqueVoterCount } = props;
  const total = match.minVoteThreshold;
  // Gate: only when a threshold is configured (matches the legacy
  // MatchContextCard + the AC5 threshold smoke spec's null-threshold case).
  if (total == null || uniqueVoterCount === undefined) return null;
  const voted = uniqueVoterCount;
  const pct = total > 0 ? Math.min(100, Math.round((voted / total) * 100)) : 0;
  return (
    <div className="mt-2 px-1">
      <div className="flex items-center justify-between text-[11px] text-muted mb-1">
        <span data-testid="vote-progress-text">
          {voted}/{total} voted
        </span>
        <span>{targetCopy(voted, total)}</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-overlay overflow-hidden"
        data-testid="vote-progress-bar"
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
