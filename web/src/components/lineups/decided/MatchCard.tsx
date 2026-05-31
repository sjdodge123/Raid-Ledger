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
  /** True if the authenticated user is a member of this match. */
  isPersonal: boolean;
  /**
   * ROK-1302: false when the lineup opted out of the scheduling phase — the
   * "Pick a time →" CTA is hidden because no scheduling poll exists.
   */
  schedulingEnabled: boolean;
}

// Sub-line emits "personal context only" — the decided-view data does not carry
// a per-match player cap (GroupedMatchesResponseDto.matchThreshold is the
// grouping-algorithm percentage 0–100, not a player count), so "X of Y players"
// is intentionally absent. Restoring it requires extending MatchDetailResponseDto
// with a per-match playerCap — tracked as a follow-up.
function matchSubLine(memberCount: number, isPersonal: boolean): string {
  if (!isPersonal) {
    return `${memberCount} ${memberCount === 1 ? 'player' : 'players'}`;
  }
  const others = Math.max(0, memberCount - 1);
  if (others === 0) return 'Just you so far';
  return `You + ${others} ${others === 1 ? 'other' : 'others'}`;
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
  isPersonal,
  schedulingEnabled,
}: MatchCardProps): JSX.Element {
  return (
    <div data-testid="decided-match-card" className="mb-2">
      <GameRef
        variant="row"
        gameId={match.gameId}
        name={match.gameName}
        coverUrl={match.gameCoverUrl}
        sub={matchSubLine(match.members.length, isPersonal)}
      />
      {isPersonal && schedulingEnabled && (
        <PickATimeCta lineupId={lineupId} matchId={match.id} />
      )}
    </div>
  );
}
