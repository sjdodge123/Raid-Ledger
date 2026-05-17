/**
 * Single match card for the Decided composite layout (ROK-1299).
 * Renders a GameRef row (drawer trigger) plus an optional "Pick a time →"
 * link to the schedule route. The CTA stops propagation so the drawer does
 * not open when the user clicks it.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { GameRef } from '../../games/GameRef';

interface MatchCardProps {
  match: MatchDetailResponseDto;
  lineupId: number;
  /** Lineup-wide per-game player cap (from GroupedMatchesResponseDto.matchThreshold). */
  threshold: number;
  /** True if the authenticated user is a member of this match. */
  isPersonal: boolean;
}

function matchSubLine(
  memberCount: number,
  threshold: number,
  isPersonal: boolean,
): string {
  if (!isPersonal) {
    return `${memberCount} ${memberCount === 1 ? 'player' : 'players'}`;
  }
  const others = Math.max(0, memberCount - 1);
  const othersText = `You + ${others} ${others === 1 ? 'other' : 'others'}`;
  const isFull = threshold > 0 && memberCount >= threshold;
  return `${memberCount} of ${threshold} · ${othersText}${isFull ? ' · group is full' : ''}`;
}

function PickATimeCta({
  lineupId,
  matchId,
}: {
  lineupId: number;
  matchId: number;
}): JSX.Element {
  return (
    <Link
      to={`/community-lineup/${lineupId}/schedule/${matchId}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 ml-12 inline-block px-3 py-1 text-xs font-medium text-emerald-300 bg-emerald-600/15 border border-emerald-500/30 rounded-md hover:bg-emerald-600/25 transition-colors"
    >
      Pick a time &rarr;
    </Link>
  );
}

export function MatchCard({
  match,
  lineupId,
  threshold,
  isPersonal,
}: MatchCardProps): JSX.Element {
  return (
    <div data-testid="decided-match-card" className="mb-2">
      <GameRef
        variant="row"
        gameId={match.gameId}
        name={match.gameName}
        coverUrl={match.gameCoverUrl}
        sub={matchSubLine(match.members.length, threshold, isPersonal)}
      />
      {isPersonal && <PickATimeCta lineupId={lineupId} matchId={match.id} />}
    </div>
  );
}
