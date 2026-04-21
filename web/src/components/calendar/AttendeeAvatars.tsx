import { useMemo } from 'react';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface SignupPreview {
    id: number;
    username: string;
    avatar: string | null;
    /** Custom uploaded avatar URL (ROK-220) */
    customAvatarUrl?: string | null;
    /** Discord user ID for avatar URL resolution (ROK-222) */
    discordId?: string | null;
    /** Optional characters for avatar resolution (ROK-194) */
    characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }>;
}

interface AttendeeAvatarsProps {
    /** Array of signups to display (first N from API) */
    signups: SignupPreview[];
    /** Total signup count for calculating overflow */
    totalCount: number;
    /** Maximum avatars to show (default 5) */
    maxVisible?: number;
    /** Avatar size: xs=16px, sm=20px, md=24px (default sm) */
    size?: 'xs' | 'sm' | 'md';
    /** Accent color for avatar borders (from game theme) */
    accentColor?: string;
    /** Optional game ID for context-aware avatar resolution (ROK-194) */
    gameId?: number;
}

/**
 * Displays overlapping attendee avatars for calendar event blocks (ROK-177, ROK-194).
 * Shows first N avatars with a "+X" badge for overflow.
 * Uses character portraits in game contexts (ROK-194).
 */
const INITIALS_COLORS = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
];

const SIZE_CLASSES = { xs: 'w-4 h-4 text-[7px]', sm: 'w-5 h-5 text-[8px]', md: 'w-6 h-6 text-[10px]' };
const SIZE_PX = { xs: 16, sm: 20, md: 24 };

function getInitialsBg(username: string): string {
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return INITIALS_COLORS[hash % INITIALS_COLORS.length];
}

function AvatarItem({ signup, index, size, accentColor, totalVisible, gameId }: {
    signup: SignupPreview; index: number; size: 'xs' | 'sm' | 'md';
    accentColor: string; totalVisible: number; gameId?: number;
}) {
    const resolved = resolveAvatar(toAvatarUser(signup), gameId);
    const avatarUrl = resolved.url;
    const sizePx = SIZE_PX[size];

    return (
        <div key={signup.id}
            className={`attendee-avatar ${SIZE_CLASSES[size]} rounded-full overflow-hidden ring-2 flex-shrink-0 flex items-center justify-center font-semibold text-foreground ${!avatarUrl ? getInitialsBg(signup.username) : ''}`}
            style={{ marginLeft: index > 0 ? `-${sizePx / 3}px` : 0, zIndex: totalVisible - index, boxShadow: `0 0 0 2px ${accentColor}` }}
            title={signup.username}>
            {avatarUrl ? (
                <img src={avatarUrl} alt={signup.username} className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <span className="select-none">{signup.username.charAt(0).toUpperCase()}</span>
            )}
        </div>
    );
}

export function AttendeeAvatars({ signups, totalCount, maxVisible = 5, size = 'sm', accentColor = '#6366f1', gameId }: AttendeeAvatarsProps) {
    const visibleSignups = useMemo(() => signups.slice(0, maxVisible), [signups, maxVisible]);
    const overflowCount = totalCount - visibleSignups.length;

    if (visibleSignups.length === 0) return null;

    return (
        <div className="attendee-avatars flex items-center" style={{ marginLeft: '2px' }}>
            <div className="flex items-center">
                {visibleSignups.map((signup, index) => (
                    <AvatarItem key={signup.id} signup={signup} index={index} size={size}
                        accentColor={accentColor} totalVisible={visibleSignups.length} gameId={gameId} />
                ))}
            </div>
            {overflowCount > 0 && (
                <span className="ml-1 text-xs text-foreground/80 font-medium whitespace-nowrap" title={`${overflowCount} more signed up`}>+{overflowCount}</span>
            )}
        </div>
    );
}
