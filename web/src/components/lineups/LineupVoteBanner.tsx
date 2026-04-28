/**
 * Banner shown on game detail pages when the game is on an active
 * Community Lineup. Lets users vote directly or navigate to the lineup.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useLineupBanner, useLineupDetail, useToggleVote } from '../../hooks/use-lineups';
import { useTiebreakerDetail } from '../../hooks/use-tiebreaker';

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
    if (banner.tiebreakerActive) {
      return (
        <TiebreakerOrVotingBanner
          lineupId={banner.id}
          gameId={gameId}
          gameName={entry.gameName}
        />
      );
    }
    return <VotingBanner lineupId={banner.id} gameId={gameId} gameName={entry.gameName} />;
  }

  if (banner.status === 'decided') {
    return <DecidedBadge lineupId={banner.id} gameName={entry.gameName} />;
  }

  return null;
}

/**
 * Routes to the tiebreaker banner when this game is among the tied games,
 * else falls back to the regular voting banner. The lookup is lazy — we
 * only fetch tiebreaker detail when banner.tiebreakerActive is true.
 */
function TiebreakerOrVotingBanner({ lineupId, gameId, gameName }: {
  lineupId: number; gameId: number; gameName: string;
}): JSX.Element {
  const { data: tiebreaker } = useTiebreakerDetail(lineupId);
  const isTiedGame = tiebreaker?.tiedGameIds?.includes(gameId) ?? false;
  if (tiebreaker && isTiedGame && tiebreaker.status === 'active') {
    return (
      <TiebreakerBanner
        lineupId={lineupId}
        gameName={gameName}
        mode={tiebreaker.mode}
        hasEngaged={hasEngaged(tiebreaker)}
      />
    );
  }
  return <VotingBanner lineupId={lineupId} gameId={gameId} gameName={gameName} />;
}

/** Whether the current user has already engaged with the tiebreaker. */
function hasEngaged(
  tiebreaker: NonNullable<ReturnType<typeof useTiebreakerDetail>['data']>,
): boolean {
  if (tiebreaker.mode === 'veto') {
    return tiebreaker.vetoStatus?.myVetoGameId != null;
  }
  // Bracket: engaged when every active matchup has a myVote
  const matchups = tiebreaker.matchups ?? [];
  if (matchups.length === 0) return false;
  return matchups.every((m) => m.isCompleted || m.myVote != null);
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

function TiebreakerBanner({ lineupId, gameName, mode, hasEngaged }: {
  lineupId: number; gameName: string; mode: 'bracket' | 'veto'; hasEngaged: boolean;
}): JSX.Element {
  const cta = mode === 'veto' ? 'Cast your veto' : 'Vote in bracket';
  const action = mode === 'veto' ? 'veto tiebreaker' : 'bracket tiebreaker';
  const message = hasEngaged
    ? `${gameName} is in a ${action} — you've already cast your vote.`
    : `${gameName} is in a ${action} — ${cta.toLowerCase()} now!`;
  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm text-amber-300">
        🎲 <strong>{message}</strong>
      </span>
      <Link
        to={`/community-lineup/${lineupId}`}
        className="text-sm font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap"
      >
        {hasEngaged ? 'View Lineup →' : `${cta} →`}
      </Link>
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
