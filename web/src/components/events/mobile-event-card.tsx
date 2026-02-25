import React from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';
import { getEventStatus, getRelativeTime, formatEventTime, STATUS_STYLES, STATUS_LABELS } from '../../lib/event-utils';
import { useTimezoneStore } from '../../stores/timezone-store';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface MobileEventCardProps {
    event: EventResponseDto;
    signupCount?: number;
    onClick?: () => void;
    matchesGameTime?: boolean;
}

/**
 * Mobile-optimized event card — horizontal layout with game color bar.
 * Renders below md breakpoint; desktop EventCard handles ≥md.
 */
export function MobileEventCard({ event, signupCount = 0, onClick, matchesGameTime }: MobileEventCardProps) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const status = getEventStatus(event.startTime, event.endTime);
    const relativeTime = getRelativeTime(event.startTime, event.endTime);
    const gameCoverUrl = event.game?.coverUrl || null;
    const [imageError, setImageError] = React.useState(false);
    const showPlaceholder = !gameCoverUrl || imageError;

    // Build avatar stack from signupsPreview (if available)
    const signupAvatars = (event.signupsPreview ?? []).slice(0, 3).map((signup) =>
        resolveAvatar(toAvatarUser(signup)),
    );

    // Use a soft fallback color when the game doesn't provide one
    const accentColor = '#10b981'; // emerald-500

    return (
        <button
            type="button"
            onClick={onClick}
            data-testid="mobile-event-card"
            className="w-full flex min-h-[96px] bg-surface rounded-lg border border-edge overflow-hidden hover:border-dim hover:shadow-lg transition-all text-left"
            style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}
        >
            {/* Game Cover Thumbnail */}
            <div className="w-16 flex-shrink-0 bg-panel">
                {!showPlaceholder && gameCoverUrl ? (
                    <img
                        src={gameCoverUrl}
                        alt={event.game?.name || ''}
                        className="w-full h-full object-cover"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 p-3 flex flex-col justify-between gap-1">
                {/* Top row: title + status */}
                <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground text-sm leading-tight truncate">
                        {event.title}
                    </h3>
                    <span
                        data-testid="mobile-event-status"
                        className={`badge-overlay flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-full border ${STATUS_STYLES[status]}`}
                    >
                        {STATUS_LABELS[status]}
                    </span>
                </div>

                {/* Middle row: game + time */}
                <div className="flex items-center gap-1.5 text-xs text-muted">
                    {event.game && (
                        <>
                            <span className="truncate">{event.game.name}</span>
                            <span className="text-dim">·</span>
                        </>
                    )}
                    <span className="whitespace-nowrap">{formatEventTime(event.startTime, resolved)}</span>
                </div>

                {/* Bottom row: relative time + game time badge + signup avatars */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span data-testid="mobile-event-relative" className="text-xs text-dim">
                            {relativeTime}
                        </span>
                        {matchesGameTime && (
                            <span className="badge-overlay flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Game Time
                            </span>
                        )}
                    </div>

                    {/* Avatar stack + signup count */}
                    <div className="flex items-center gap-1">
                        <div className="flex -space-x-1.5" data-testid="mobile-event-avatars">
                            {signupAvatars.map((avatar, i) => (
                                <div key={i} className="w-5 h-5 rounded-full border border-surface bg-overlay overflow-hidden">
                                    {avatar.url ? (
                                        <img src={avatar.url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-[8px] text-muted font-medium">
                                            ?
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        {signupCount > 0 && (
                            <span data-testid="mobile-event-signup-count" className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">
                                {signupCount > 3 ? `+${signupCount - 3}` : signupCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}

/**
 * Skeleton loader for mobile event cards during loading state
 */
export function MobileEventCardSkeleton() {
    return (
        <div className="w-full flex min-h-[96px] bg-surface rounded-lg border border-edge overflow-hidden animate-pulse" style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--color-dim)' }}>
            <div className="w-16 flex-shrink-0 bg-panel" />
            <div className="flex-1 p-3 flex flex-col justify-between gap-1">
                <div className="h-4 bg-panel rounded w-3/4" />
                <div className="h-3 bg-panel rounded w-1/2" />
                <div className="h-3 bg-panel rounded w-1/4" />
            </div>
        </div>
    );
}
