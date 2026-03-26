/**
 * Vote status bar for the voting leaderboard (ROK-936).
 * Shows personal vote usage and community participation.
 */
import type { JSX } from 'react';

interface VoteStatusBarProps {
  myVoteCount: number;
  maxVotes: number;
  totalVoters: number;
  totalMembers: number;
}

/** Emerald status bar: vote usage + participation. */
export function VoteStatusBar({
  myVoteCount,
  maxVotes,
  totalVoters,
  totalMembers,
}: VoteStatusBarProps): JSX.Element {
  return (
    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-emerald-400 text-sm font-medium">
          You&apos;ve used {myVoteCount} of {maxVotes} votes
        </span>
      </div>
      <span className="text-dim text-xs">{totalVoters} / {totalMembers} voted</span>
    </div>
  );
}
