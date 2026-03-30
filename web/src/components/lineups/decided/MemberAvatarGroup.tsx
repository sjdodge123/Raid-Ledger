/**
 * Avatar group showing match members with real avatars (ROK-989).
 * Uses the same avatar resolution as event cards: custom > Discord > initials.
 * Displays up to `max` circles plus a "+N more" overflow indicator.
 */
import type { JSX } from 'react';
import { buildDiscordAvatarUrl } from '../../../lib/avatar';
import { API_BASE_URL } from '../../../lib/config';

interface Member {
  userId: number;
  displayName: string;
  avatar: string | null;
  discordId: string | null;
  customAvatarUrl: string | null;
}

interface MemberAvatarGroupProps {
  members: Member[];
  max?: number;
}

/** Resolve the best avatar URL for a member. */
function memberAvatarUrl(m: Member): string | null {
  if (m.customAvatarUrl) return `${API_BASE_URL}${m.customAvatarUrl}`;
  return buildDiscordAvatarUrl(m.discordId, m.avatar);
}

/** Deterministic pastel color from a user ID (fallback). */
function avatarColor(userId: number): string {
  const palette = [
    'bg-emerald-600', 'bg-cyan-600', 'bg-violet-600',
    'bg-amber-600', 'bg-rose-600', 'bg-blue-600',
    'bg-teal-600', 'bg-pink-600',
  ];
  return palette[userId % palette.length];
}

/** Initials fallback circle. */
function InitialAvatar({ member }: { member: Member }): JSX.Element {
  const initial = member.displayName[0]?.toUpperCase() ?? '?';
  return (
    <div
      title={member.displayName}
      className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-surface ${avatarColor(member.userId)}`}
    >
      {initial}
    </div>
  );
}

/** Single member avatar with image or initials fallback. */
function MemberAvatar({ member }: { member: Member }): JSX.Element {
  const url = memberAvatarUrl(member);
  if (!url) return <InitialAvatar member={member} />;

  return (
    <img
      src={url}
      alt={member.displayName}
      title={member.displayName}
      className="w-7 h-7 rounded-full border-2 border-surface object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        const parent = el.parentElement;
        if (!parent) return;
        el.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.title = member.displayName;
        fallback.className = `w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-surface ${avatarColor(member.userId)}`;
        fallback.textContent = member.displayName[0]?.toUpperCase() ?? '?';
        parent.insertBefore(fallback, el);
      }}
    />
  );
}

/** Stacked avatar group with overflow count. */
export function MemberAvatarGroup({
  members,
  max = 5,
}: MemberAvatarGroupProps): JSX.Element {
  const visible = members.slice(0, max);
  const overflow = members.length - max;

  return (
    <div className="flex -space-x-1.5">
      {visible.map((m) => (
        <MemberAvatar key={m.userId} member={m} />
      ))}
      {overflow > 0 && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-zinc-300 bg-zinc-700 border-2 border-surface">
          +{overflow}
        </div>
      )}
    </div>
  );
}
