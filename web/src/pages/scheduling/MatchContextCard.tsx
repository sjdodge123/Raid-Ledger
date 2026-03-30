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
}

/** Convert a match member to an AvatarUser for the shared component. */
function toUser(m: MatchDetailResponseDto['members'][number]) {
  return toAvatarUser({
    id: m.userId,
    username: m.displayName,
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

/** Card displaying match game details and member info. */
export function MatchContextCard({ match }: MatchContextCardProps): JSX.Element {
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
      </div>
    </div>
  );
}
