/**
 * Avatar group showing match members (ROK-989).
 * Uses the shared AvatarWithFallback component for consistent avatar resolution.
 * Displays up to `max` circles plus a "+N more" overflow indicator.
 */
import type { JSX } from 'react';
import { toAvatarUser } from '../../../lib/avatar';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';

interface Member {
  userId: number;
  displayName: string;
  avatar: string | null;
  discordId: string | null;
  customAvatarUrl: string | null;
  characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }>;
}

interface MemberAvatarGroupProps {
  members: Member[];
  max?: number;
  gameId?: number | string;
}

/** Convert a match member to an AvatarUser for the shared component. */
function toUser(m: Member) {
  return toAvatarUser({
    id: m.userId,
    avatar: m.avatar,
    discordId: m.discordId,
    customAvatarUrl: m.customAvatarUrl,
    characters: m.characters,
  });
}

/** Stacked avatar group with overflow count. */
export function MemberAvatarGroup({
  members,
  max = 5,
  gameId,
}: MemberAvatarGroupProps): JSX.Element {
  const visible = members.slice(0, max);
  const overflow = members.length - max;

  return (
    <div data-testid="member-avatar-group" className="flex -space-x-1.5">
      {visible.map((m) => (
        <div key={m.userId} title={m.displayName}>
          <AvatarWithFallback
            user={toUser(m)}
            username={m.displayName}
            sizeClassName="w-7 h-7"
            gameId={gameId}
          />
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-300 bg-zinc-700 border-2 border-surface">
          +{overflow}
        </div>
      )}
    </div>
  );
}
