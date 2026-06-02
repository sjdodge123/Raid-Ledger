/**
 * U2 game-reference banner for the ROK-1300 Scheduling composite.
 *
 * Replaces the legacy standalone `MatchContextCard` on the poll page: game
 * cover + name with an `ⓘ` affordance that opens the `GameResearchDrawer`
 * (mounted by the composite), plus a member/match context line + avatar stack.
 * Mode-aware copy: standalone → "You + N invited members"; from-match →
 * "Match: You + N others".
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import type { SchedulingMode } from './scheduling-submit-copy';

export interface SchedulingGameRefBannerProps {
  match: MatchDetailResponseDto;
  mode: SchedulingMode;
  /** Open the GameResearchDrawer for this match's game. */
  onResearch: () => void;
}

/** Member/match context line copy. */
function contextLine(
  mode: SchedulingMode,
  memberCount: number,
): string {
  const others = Math.max(0, memberCount - 1);
  if (mode === 'standalone') {
    return others === 0
      ? 'Just you so far'
      : `You + ${others} invited member${others === 1 ? '' : 's'}`;
  }
  return others === 0 ? 'Match: just you' : `Match: You + ${others} others`;
}

/** Game-ref banner — see file-level docstring. */
export function SchedulingGameRefBanner(
  props: SchedulingGameRefBannerProps,
): JSX.Element {
  const { match, mode, onResearch } = props;
  return (
    <div
      data-testid="scheduling-game-ref"
      className="flex items-center gap-3 p-3 rounded-xl bg-panel border border-edge"
    >
      {match.gameCoverUrl && (
        <img
          src={match.gameCoverUrl}
          alt={match.gameName}
          className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h2
            data-testid="match-game-name"
            className="text-base font-semibold text-foreground truncate"
          >
            {match.gameName}
          </h2>
          <button
            type="button"
            onClick={onResearch}
            aria-label={`Research ${match.gameName}`}
            data-testid="scheduling-game-research"
            className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border border-edge text-[11px] text-muted hover:text-foreground hover:border-emerald-500/60 transition-colors"
          >
            ⓘ
          </button>
        </div>
        <p className="text-xs text-muted">{contextLine(mode, match.members.length)}</p>
        <div className="mt-1.5">
          <MemberAvatarGroup
            members={match.members.map((m) => ({
              userId: m.userId,
              displayName: m.displayName,
              avatar: m.avatar,
              discordId: m.discordId,
              customAvatarUrl: m.customAvatarUrl,
            }))}
            max={6}
          />
        </div>
      </div>
    </div>
  );
}
