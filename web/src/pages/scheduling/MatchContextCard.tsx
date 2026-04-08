/**
 * Match context card showing game thumbnail, name, member count, and avatars (ROK-965).
 * Uses the shared AvatarWithFallback component for consistent avatar resolution.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { toAvatarUser } from '../../lib/avatar';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';

interface MatchContextCardProps {
  match: MatchDetailResponseDto;
  /** Count of distinct users who have voted on any slot (ROK-1015). */
  uniqueVoterCount?: number;
}

/** Convert a match member to an AvatarUser for the shared component. */
function toUser(m: MatchDetailResponseDto['members'][number]) {
  return toAvatarUser({
    id: m.userId,
    avatar: m.avatar,
    discordId: m.discordId,
    customAvatarUrl: m.customAvatarUrl,
  });
}

/** Stacked member avatar row (max 8 visible + overflow count). */
function MemberAvatarStack({ members }: {
  members: MatchContextCardProps['match']['members'];
}): JSX.Element {
  const maxVisible = 8;
  const visible = members.slice(0, maxVisible);
  const overflowCount = members.length - maxVisible;

  return (
    <div className="flex -space-x-1.5" data-testid="member-avatars">
      {visible.map((m) => (
        <div key={m.userId} title={m.displayName}>
          <AvatarWithFallback
            user={toUser(m)}
            username={m.displayName}
            sizeClassName="w-8 h-8"
          />
        </div>
      ))}
      {overflowCount > 0 && (
        <div className="w-8 h-8 rounded-full bg-overlay border-2 border-surface flex items-center justify-center text-xs font-semibold text-muted">
          +{overflowCount}
        </div>
      )}
    </div>
  );
}

/** Progress bar showing X of Y members have voted (ROK-1015). */
function VoteProgressBar({ voted, total }: {
  voted: number;
  total: number;
}): JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((voted / total) * 100)) : 0;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-muted mb-1">
        <span data-testid="vote-progress-text">{voted}/{total} voted</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-overlay overflow-hidden"
        data-testid="vote-progress-bar">
        <div className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Card displaying match game details and member info. */
export function MatchContextCard({ match, uniqueVoterCount }: MatchContextCardProps): JSX.Element {
  return (
    <div
      data-testid="match-context-card"
      className="flex items-center gap-4 p-4 rounded-xl bg-panel border border-edge"
    >
      {match.gameCoverUrl && (
        <img
          src={match.gameCoverUrl}
          alt={match.gameName}
          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <h2
          data-testid="match-game-name"
          className="text-lg font-semibold text-foreground truncate"
        >
          {match.gameName}
        </h2>
        <p className="text-sm text-muted">
          {match.members.length} {match.members.length === 1 ? 'member' : 'members'}
        </p>
        <div className="mt-2">
          <MemberAvatarStack members={match.members} />
        </div>
        {uniqueVoterCount !== undefined && match.minVoteThreshold != null && (
          <VoteProgressBar voted={uniqueVoterCount} total={match.minVoteThreshold} />
        )}
      </div>
    </div>
  );
}
