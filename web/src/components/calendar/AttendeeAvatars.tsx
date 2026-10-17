import { useMemo } from 'react';
import { toAvatarUser } from '../../lib/avatar';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';

interface SignupPreview {
    id: number;
    username: string;
    avatar: string | null;
    /** Custom uploaded avatar URL (ROK-220) */
    customAvatarUrl?: string | null;
    /** Discord user ID for avatar URL resolution (ROK-222) */
    discordId?: string | null;
    /** Optional characters for avatar resolution (ROK-194) */
    characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }> | undefined;
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
    gameId?: number | undefined;
}

/**
 * Displays overlapping attendee avatars for calendar event blocks (ROK-177, ROK-194).
 * Shows first N avatars with a "+X" badge for overflow.
 * Uses character portraits in game contexts (ROK-194).
 */
const SIZE_CLASSES = { xs: 'w-4 h-4 text-[7px]', sm: 'w-5 h-5 text-[8px]', md: 'w-6 h-6 text-[10px]' };
const SIZE_PX = { xs: 16, sm: 20, md: 24 };

function AvatarItem({ signup, index, size, accentColor, totalVisible, gameId }: {
    signup: SignupPreview; index: number; size: 'xs' | 'sm' | 'md';
    accentColor: string; totalVisible: number; gameId?: number | undefined;
}) {
    const sizePx = SIZE_PX[size];

    return (
        <div key={signup.id}
            className={`attendee-avatar ${SIZE_CLASSES[size]} rounded-full overflow-hidden ring-2 flex-shrink-0 flex items-center justify-center`}
            style={{ marginLeft: index > 0 ? `-${sizePx / 3}px` : 0, zIndex: totalVisible - index, boxShadow: `0 0 0 2px ${accentColor}` }}
            title={signup.username}>
            {/* ROK-1714: neutral-token initials on a missing or dead avatar; font size inherits SIZE_CLASSES. */}
            <AvatarWithFallback user={toAvatarUser(signup)} gameId={gameId} username={signup.username}
                sizeClassName="w-full h-full text-[length:inherit]!" loading="lazy" />
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
