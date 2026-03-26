/**
 * Voting leaderboard for the lineup voting phase (ROK-936).
 * Renders sorted entries with vote bars and pick-3 toggle.
 */
import { useMemo, useCallback } from 'react';
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useToggleVote } from '../../hooks/use-lineups';
import { VoteStatusBar } from './VoteStatusBar';
import { LeaderboardRow } from './LeaderboardRow';
import { toast } from '../../lib/toast';

interface VotingLeaderboardProps {
  entries: LineupEntryResponseDto[];
  lineupId: number;
  myVotes: number[];
  totalVoters: number;
  totalMembers: number;
}

const MAX_VOTES = 3;

/** Sort entries by voteCount desc, ownerCount desc as tiebreaker. */
function sortByVotes(entries: LineupEntryResponseDto[]): LineupEntryResponseDto[] {
  return [...entries].sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.ownerCount - a.ownerCount;
  });
}

/** Voting leaderboard with status bar, sorted rows, and pick-3 logic. */
export function VotingLeaderboard({
  entries, lineupId, myVotes, totalVoters, totalMembers,
}: VotingLeaderboardProps): JSX.Element {
  const sorted = useMemo(() => sortByVotes(entries), [entries]);
  const votedSet = useMemo(() => new Set(myVotes), [myVotes]);
  const toggleVote = useToggleVote();

  const handleToggle = useCallback(
    (gameId: number) => {
      toggleVote.mutate(
        { lineupId, gameId },
        { onError: (err) => toast.error(err instanceof Error ? err.message : 'Vote failed') },
      );
    },
    [lineupId, toggleVote],
  );

  const atLimit = myVotes.length >= MAX_VOTES;

  return (
    <div data-testid="voting-leaderboard">
      <VoteStatusBar
        myVoteCount={myVotes.length}
        maxVotes={MAX_VOTES}
        totalVoters={totalVoters}
        totalMembers={totalMembers}
      />
      <div className="bg-surface border border-edge rounded-xl overflow-hidden mt-4">
        <div className="bg-panel/50 border-b border-edge px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Rank</span>
          <span className="text-xs text-muted font-semibold uppercase tracking-wider">Votes</span>
        </div>
        {sorted.map((entry, i) => {
          const isVoted = votedSet.has(entry.gameId);
          return (
            <LeaderboardRow
              key={entry.id}
              entry={entry}
              rank={i + 1}
              totalVoters={totalVoters}
              isVoted={isVoted}
              onToggleVote={() => handleToggle(entry.gameId)}
              disabled={atLimit && !isVoted}
            />
          );
        })}
      </div>
    </div>
  );
}
