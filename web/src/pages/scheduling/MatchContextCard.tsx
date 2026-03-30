/**
 * Match context card showing game thumbnail, name, member count, and avatars (ROK-965).
 * Displayed at the top of the scheduling poll page.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface MatchContextCardProps {
  match: MatchDetailResponseDto;
}

/** Single member avatar with fallback initial. */
function MemberAvatar({ member }: {
  member: { userId: number; displayName: string; avatar: string | null; discordId: string | null; customAvatarUrl: string | null };
}): JSX.Element {
  const avatarInfo = resolveAvatar(toAvatarUser({
    id: member.userId,
    username: member.displayName,
    avatar: member.avatar,
  }));

  if (avatarInfo.url) {
    return (
      <img
        src={avatarInfo.url}
        alt={member.displayName}
        className="w-8 h-8 rounded-full border-2 border-surface -ml-2 first:ml-0"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-overlay border-2 border-surface -ml-2 first:ml-0 flex items-center justify-center text-xs font-semibold text-muted">
      {member.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

/** Stacked member avatar row (max 8 visible + overflow count). */
function MemberAvatarStack({ members }: {
  members: MatchContextCardProps['match']['members'];
}): JSX.Element {
  const maxVisible = 8;
  const visible = members.slice(0, maxVisible);
  const overflowCount = members.length - maxVisible;

  return (
    <div className="flex items-center" data-testid="member-avatars">
      {visible.map((m) => (
        <MemberAvatar key={m.userId} member={m} />
      ))}
      {overflowCount > 0 && (
        <div className="w-8 h-8 rounded-full bg-overlay border-2 border-surface -ml-2 flex items-center justify-center text-xs font-semibold text-muted">
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
