/**
 * Banner shown on game detail pages when the game is on an active
 * Community Lineup. Lets users vote directly or navigate to the lineup.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useLineupBanner, useLineupDetail, useToggleVote } from '../../hooks/use-lineups';

interface Props {
  gameId: number;
}

export function LineupVoteBanner({ gameId }: Props): JSX.Element | null {
  const { data: banner } = useLineupBanner();
  if (!banner) return null;

  const entry = banner.entries.find((e) => e.gameId === gameId);
  if (!entry) return null;

  if (banner.status === 'building') {
    return <NominatedBadge lineupId={banner.id} />;
  }

  if (banner.status === 'voting') {
    return <VotingBanner lineupId={banner.id} gameId={gameId} gameName={entry.gameName} />;
  }

  if (banner.status === 'decided') {
    return <DecidedBadge lineupId={banner.id} gameName={entry.gameName} />;
  }

  return null;
}

function NominatedBadge({ lineupId }: { lineupId: number }): JSX.Element {
  return (
    <div className="mb-6 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 flex items-center justify-between gap-3">
      <span className="text-sm text-indigo-300">
        🎲 This game is <strong>nominated</strong> on the Community Lineup.
      </span>
      <Link
        to={`/community-lineup/${lineupId}`}
        className="text-sm font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap"
      >
        View Lineup →
      </Link>
    </div>
  );
}

function VotingBanner({ lineupId, gameId, gameName }: {
  lineupId: number; gameId: number; gameName: string;
}): JSX.Element {
  const { data: detail } = useLineupDetail(lineupId);
  const voteMutation = useToggleVote();
  const hasVoted = detail?.myVotes?.includes(gameId) ?? false;
  const isVoting = voteMutation.isPending;

  const handleVote = () => {
    voteMutation.mutate({ lineupId, gameId });
  };

  return (
    <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm text-emerald-300">
        🗳️ <strong>{gameName}</strong> is up for a vote on the Community Lineup!
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleVote}
          disabled={isVoting}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            hasVoted
              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
              : 'bg-overlay text-foreground hover:bg-emerald-600 hover:text-white border border-emerald-500/40'
          }`}
        >
          {hasVoted ? '✓ Voted' : 'Vote'}
        </button>
        <Link
          to={`/community-lineup/${lineupId}`}
          className="text-sm font-medium text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
        >
          View Lineup →
        </Link>
      </div>
    </div>
  );
}

function DecidedBadge({ lineupId, gameName }: { lineupId: number; gameName: string }): JSX.Element {
  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
      <span className="text-sm text-amber-300">
        🎯 <strong>{gameName}</strong> is matched — schedule a time to play!
      </span>
      <Link
        to={`/community-lineup/${lineupId}`}
        className="text-sm font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap"
      >
        View Lineup →
      </Link>
    </div>
  );
}
