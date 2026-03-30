/**
 * Tier 2 ("Almost There") match card (ROK-989).
 * Medium card with "Join This Match" bandwagon button.
 * Disabled "Joined" state for existing members.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { MatchProgressRing } from './MatchProgressRing';
import { MemberAvatarGroup } from './MemberAvatarGroup';
import { useBandwagonJoin } from '../../../hooks/use-lineup-matches';
import { useAuth } from '../../../hooks/use-auth';

interface AlmostThereCardProps {
  match: MatchDetailResponseDto;
  lineupId: number;
  matchThreshold: number;
}

/** Join / Joined button for Tier 2 cards. */
function JoinButton({
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
      <button type="button" disabled className="w-full py-2 text-sm font-medium text-zinc-400 bg-zinc-700 rounded-lg cursor-not-allowed">
        Joined
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => bandwagon.mutate({ lineupId, matchId: match.id })}
      disabled={bandwagon.isPending}
      className="w-full py-2 text-sm font-medium text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
    >
      Join This Match
    </button>
  );
}

/** Medium card for Tier 2 matches. */
export function AlmostThereCard({
  match, lineupId, matchThreshold,
}: AlmostThereCardProps): JSX.Element {
  const { user } = useAuth();

  return (
    <div
      data-testid="match-card"
      className="bg-surface border border-edge rounded-lg p-4"
    >
      <div className="flex items-start gap-3">
        <MatchProgressRing
          current={match.members.length}
          target={matchThreshold}
          size={44}
          color="#10b981"
        />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">{match.gameName}</h4>
          <span className="text-[11px] text-dim">
            {match.members.length} / {matchThreshold} players
          </span>
        </div>
      </div>
      <div className="mt-3 mb-3">
        <MemberAvatarGroup members={match.members} max={6} />
      </div>
      <JoinButton match={match} lineupId={lineupId} userId={user?.id} />
    </div>
  );
}
