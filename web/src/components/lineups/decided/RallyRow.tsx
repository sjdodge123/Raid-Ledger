/**
 * Rally row for Tier 3 ("Rally Your Crew") matches (ROK-989).
 * Compact row with progress ring, "I'm interested" button,
 * operator "Advance" button, and rally URL share icon.
 */
import { useRef, useEffect } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { MatchProgressRing } from './MatchProgressRing';
import { useBandwagonJoin, useAdvanceMatch } from '../../../hooks/use-lineup-matches';
import { useAuth, isOperatorOrAdmin } from '../../../hooks/use-auth';

interface RallyRowProps {
  match: MatchDetailResponseDto;
  lineupId: number;
  matchThreshold: number;
  isRallied: boolean;
}

/** Copy the rally URL to clipboard. */
function copyRallyUrl(lineupId: number, gameId: number): void {
  const url = `${window.location.origin}/community-lineup/${lineupId}?rally=${gameId}`;
  void navigator.clipboard.writeText(url);
}

/** Share icon SVG for copying rally URL. */
function ShareIcon({
  lineupId,
  gameId,
}: {
  lineupId: number;
  gameId: number;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="rally-share-icon"
      onClick={() => copyRallyUrl(lineupId, gameId)}
      title="Copy rally link"
      className="text-dim hover:text-foreground transition-colors p-1"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
        />
      </svg>
    </button>
  );
}

/** Join / Joined button for rally rows. */
function RallyJoinButton({
  match, lineupId, userId,
}: {
  match: MatchDetailResponseDto;
  lineupId: number;
  userId: number | undefined;
}): JSX.Element {
  const bandwagon = useBandwagonJoin();
  const isMember = match.members.some((m) => m.userId === userId);

  if (isMember) {
    return (
      <button type="button" disabled className="px-3 py-1 text-xs font-medium text-zinc-400 bg-zinc-700 rounded cursor-not-allowed">
        Joined
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => bandwagon.mutate({ lineupId, matchId: match.id })}
      disabled={bandwagon.isPending}
      className="px-3 py-1 text-xs font-medium text-amber-300 bg-amber-500/20 border border-amber-500/30 rounded hover:bg-amber-500/30 transition-colors disabled:opacity-50"
    >
      I&apos;m interested
    </button>
  );
}

/** Operator advance button. */
function AdvanceButton({
  match, lineupId,
}: {
  match: MatchDetailResponseDto;
  lineupId: number;
}): JSX.Element {
  const advance = useAdvanceMatch();
  return (
    <button
      type="button"
      onClick={() => advance.mutate({ lineupId, matchId: match.id })}
      disabled={advance.isPending}
      className="px-2 py-1 text-[10px] font-medium text-cyan-300 hover:text-cyan-200 transition-colors disabled:opacity-50"
    >
      Advance
    </button>
  );
}

/** Hook to auto-scroll to element when rally-highlighted. */
function useRallyScroll(isRallied: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isRallied && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isRallied]);
  return ref;
}

/** Row class name based on rally highlight state. */
function rallyClassName(isRallied: boolean): string {
  const base = 'flex items-center gap-3 px-3 py-2.5 rounded-lg';
  return isRallied ? `${base} bg-amber-500/10 ring-1 ring-amber-500/30` : `${base} bg-surface/50`;
}

/** Compact row for Tier 3 rally matches. */
export function RallyRow({
  match, lineupId, matchThreshold, isRallied,
}: RallyRowProps): JSX.Element {
  const rowRef = useRallyScroll(isRallied);
  const { user } = useAuth();
  const canOperate = isOperatorOrAdmin(user);

  return (
    <div ref={rowRef} data-testid="rally-row" data-rallied={isRallied ? 'true' : undefined} className={rallyClassName(isRallied)}>
      <MatchProgressRing current={match.members.length} target={matchThreshold} size={36} color="#f59e0b" />
      <div className="flex-1 min-w-0">
        <Link to={`/games/${match.gameId}`} className="text-sm font-medium text-foreground truncate block hover:text-emerald-400 transition-colors">{match.gameName}</Link>
        <span className="text-[10px] text-dim">{match.members.length} interested</span>
      </div>
      <RallyJoinButton match={match} lineupId={lineupId} userId={user?.id} />
      {canOperate && <AdvanceButton match={match} lineupId={lineupId} />}
      <ShareIcon lineupId={lineupId} gameId={match.gameId} />
    </div>
  );
}
