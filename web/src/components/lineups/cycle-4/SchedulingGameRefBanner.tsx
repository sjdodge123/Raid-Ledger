/**
 * U2 game-reference for the ROK-1300 Scheduling composite (rework round 2).
 *
 * Lives INLINE inside the sticky hero toolbar, on the submit row (game-ref
 * left, submit button right). The whole control (cover + name) is clickable
 * and navigates to the game-detail page `/games/:id` — `GameResearchDrawer`
 * already just navigates there (ROK-1297), so we navigate directly. The `ⓘ`
 * is the hover affordance signalling the row is clickable.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../decided/MemberAvatarGroup';
import type { SchedulingMode } from './scheduling-submit-copy';

export interface SchedulingGameRefBannerProps {
  match: MatchDetailResponseDto;
  mode: SchedulingMode;
}

/** Member/match context line copy. */
function contextLine(mode: SchedulingMode, memberCount: number): string {
  const others = Math.max(0, memberCount - 1);
  if (mode === 'standalone') {
    // "member", not "invited member" — voters self-enroll on open-roster
    // polls, so not everyone here was explicitly invited.
    return others === 0
      ? 'Just you so far'
      : `You + ${others} member${others === 1 ? '' : 's'}`;
  }
  return others === 0 ? 'Match: just you' : `Match: You + ${others} others`;
}

/** Clickable game-ref → /games/:id — see file-level docstring. */
export function SchedulingGameRefBanner(
  props: SchedulingGameRefBannerProps,
): JSX.Element {
  const { match, mode } = props;
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/games/${match.gameId}`)}
      aria-label={`View ${match.gameName} details`}
      data-testid="scheduling-game-ref"
      className="group flex min-w-0 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-overlay/40 cursor-pointer"
    >
      {match.gameCoverUrl && (
        <img
          src={match.gameCoverUrl}
          alt={match.gameName}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            data-testid="match-game-name"
            className="text-sm font-semibold text-foreground truncate group-hover:text-emerald-300"
          >
            {match.gameName}
          </span>
          <span
            aria-hidden="true"
            data-testid="scheduling-game-research"
            className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full border border-edge text-[10px] text-muted group-hover:text-emerald-300 group-hover:border-emerald-500/60 transition-colors"
          >
            ⓘ
          </span>
        </div>
        <p className="text-[11px] text-muted">
          {contextLine(mode, match.members.length)}
        </p>
        <div className="mt-1">
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
    </button>
  );
}
