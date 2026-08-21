/**
 * Single match card for the Decided composite layout (ROK-1299).
 * Renders a GameRef row (drawer trigger) plus an optional CTA — either a
 * "View Event →" link when the match is already linked to an event, or a
 * "Pick a time →" link to the schedule route. The CTA stops propagation so
 * the drawer does not open when the user clicks it.
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

// ROK-1411: `match.playerCap` (from games.player_count.max) is the "X of Y
// players" denominator. When it is null the game has no known cap, so we fall
// back to the personal-context copy ("You + N others") / raw count
// ("N players") that carries no false denominator.
function matchSubLine(
  memberCount: number,
  isPersonal: boolean,
  playerCap: number | null,
): string {
  if (playerCap != null) {
    const base = `${memberCount} of ${playerCap} players`;
    return memberCount >= playerCap ? `${base} · Group is full` : base;
  }
  if (!isPersonal) {
    return `${memberCount} ${memberCount === 1 ? 'player' : 'players'}`;
  }
  const others = Math.max(0, memberCount - 1);
  if (others === 0) return 'Just you so far';
  return `You + ${others} ${others === 1 ? 'other' : 'others'}`;
}

function ViewEventCta({ eventId }: { eventId: number }): JSX.Element {
  return (
    <Link
      to={`/events/${eventId}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 ml-12 inline-block px-3 py-1 text-xs font-medium text-emerald-300 bg-emerald-600/15 border border-emerald-500/30 rounded-md hover:bg-emerald-600/25 transition-colors"
    >
      View Event &rarr;
    </Link>
  );
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

// ROK-1411: a match with a `linkedEventId` already resolved into a concrete
// event, so we link straight to it and skip the schedule poll. This overrides
// the ROK-1302 opt-out gating: an opted-out lineup (`schedulingEnabled=false`)
// has no poll — "Pick a time" is hidden — but if such a match was still turned
// into an event, "View Event" must surface. Poll-vs-event is exclusive; the
// linked event always wins.
function MatchCta({
  match,
  lineupId,
  schedulingEnabled,
}: {
  match: MatchDetailResponseDto;
  lineupId: number;
  schedulingEnabled: boolean;
}): JSX.Element | null {
  if (match.linkedEventId != null) {
    return <ViewEventCta eventId={match.linkedEventId} />;
  }
  if (!schedulingEnabled) return null;
  return <PickATimeCta lineupId={lineupId} matchId={match.id} />;
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
        sub={matchSubLine(match.members.length, isPersonal, match.playerCap)}
      />
      {isPersonal && (
        <MatchCta
          match={match}
          lineupId={lineupId}
          schedulingEnabled={schedulingEnabled}
        />
      )}
    </div>
  );
}
