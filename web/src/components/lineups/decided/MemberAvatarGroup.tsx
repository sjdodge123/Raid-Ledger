/**
 * Avatar group showing member initials with color hash (ROK-989).
 * Displays up to `max` circles plus a "+N more" overflow indicator.
 */
import type { JSX } from 'react';

interface Member {
  userId: number;
  displayName: string;
}

interface MemberAvatarGroupProps {
  members: Member[];
  max?: number;
}

/** Deterministic pastel color from a user ID. */
function avatarColor(userId: number): string {
  const palette = [
    'bg-emerald-600', 'bg-cyan-600', 'bg-violet-600',
    'bg-amber-600', 'bg-rose-600', 'bg-blue-600',
    'bg-teal-600', 'bg-pink-600',
  ];
  return palette[userId % palette.length];
}

/** Extract up to 2 initials from a display name. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
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
        <div
          key={m.userId}
          title={m.displayName}
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-surface ${avatarColor(m.userId)}`}
        >
          {initials(m.displayName)}
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
