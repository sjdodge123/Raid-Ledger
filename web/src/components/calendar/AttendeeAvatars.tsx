import { useMemo } from 'react';
import { resolveAvatar } from '../../lib/avatar';

interface SignupPreview {
    id: number;
    username: string;
    avatar: string | null;
    /** Optional characters for avatar resolution (ROK-194) */
    characters?: Array<{ gameId: string; avatarUrl: string | null }>;
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
    gameId?: string;
}

/**
 * Displays overlapping attendee avatars for calendar event blocks (ROK-177, ROK-194).
 * Shows first N avatars with a "+X" badge for overflow.
 * Uses character portraits in game contexts (ROK-194).
 */
export function AttendeeAvatars({
    signups,
    totalCount,
    maxVisible = 5,
    size = 'sm',
    accentColor = '#6366f1', // Default indigo
    gameId,
}: AttendeeAvatarsProps) {
    // Calculate visible signups and overflow
    const visibleSignups = useMemo(
        () => signups.slice(0, maxVisible),
        [signups, maxVisible]
    );
    const overflowCount = totalCount - visibleSignups.length;

    // Size classes - ROK-186: Added xs for short events
    const sizeClasses = {
        xs: 'w-4 h-4 text-[7px]',
        sm: 'w-5 h-5 text-[8px]',
        md: 'w-6 h-6 text-[10px]',
    };
    const sizePx = size === 'xs' ? 16 : size === 'sm' ? 20 : 24;

    // Generate initials from username
    const getInitials = (username: string): string => {
        return username.charAt(0).toUpperCase();
    };

    // Generate a consistent background color from username
    const getInitialsBg = (username: string): string => {
        const colors = [
            'bg-red-500',
            'bg-orange-500',
            'bg-amber-500',
            'bg-yellow-500',
            'bg-lime-500',
            'bg-green-500',
            'bg-emerald-500',
            'bg-teal-500',
            'bg-cyan-500',
            'bg-sky-500',
            'bg-blue-500',
            'bg-indigo-500',
            'bg-violet-500',
            'bg-purple-500',
            'bg-fuchsia-500',
            'bg-pink-500',
        ];
        const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[hash % colors.length];
    };

    if (visibleSignups.length === 0) {
        return null;
    }

    return (
        <div
            className="attendee-avatars flex items-center"
            style={{ marginLeft: '2px' }}
        >
            {/* Avatar stack */}
            <div className="flex items-center">
                {visibleSignups.map((signup, index) => {
                    // ROK-194: Resolve avatar based on game context
                    const resolved = resolveAvatar(signup, gameId);
                    const avatarUrl = resolved.url;

                    return (
                        <div
                            key={signup.id}
                            className={`
                            attendee-avatar 
                            ${sizeClasses[size]} 
                            rounded-full 
                            overflow-hidden 
                            ring-2
                            flex-shrink-0
                            flex items-center justify-center
                            font-semibold text-foreground
                            ${!avatarUrl ? getInitialsBg(signup.username) : ''}
                        `}
                            style={{
                                marginLeft: index > 0 ? `-${sizePx / 3}px` : 0,
                                zIndex: visibleSignups.length - index,
                                boxShadow: `0 0 0 2px ${accentColor}`,
                            }}
                            title={signup.username}
                        >
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={signup.username}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <span className="select-none">
                                    {getInitials(signup.username)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Overflow badge */}
            {overflowCount > 0 && (
                <span
                    className="ml-1 text-xs text-foreground/80 font-medium whitespace-nowrap"
                    title={`${overflowCount} more signed up`}
                >
                    +{overflowCount}
                </span>
            )}
        </div>
    );
}
