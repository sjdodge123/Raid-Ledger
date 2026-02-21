import React from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';
import { getEventStatus, getRelativeTime } from '../../lib/event-utils';
import { useTimezoneStore } from '../../stores/timezone-store';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface EventCardProps {
    event: EventResponseDto;
    signupCount?: number;
    onClick?: () => void;
    /** Show a "Fits your schedule" badge when event overlaps with game time */
    matchesGameTime?: boolean;
}

type EventStatus = 'upcoming' | 'live' | 'ended' | 'cancelled';

/**
 * Status badge component with color coding
 */
function StatusBadge({ status }: { status: EventStatus }) {
    const styles: Record<EventStatus, string> = {
        upcoming: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        live: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        ended: 'bg-dim/20 text-muted border-dim/30',
        cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
    };

    const labels: Record<EventStatus, string> = {
        upcoming: 'Upcoming',
        live: 'Live',
        ended: 'Ended',
        cancelled: 'Cancelled',
    };

    return (
        <span
            data-testid="event-status-badge"
            aria-label={`Event status: ${status}`}
            className={`px-2 py-0.5 text-xs font-medium rounded-full border ${styles[status]}`}
        >
            {labels[status]}
        </span>
    );
}

/**
 * Format date/time in user's preferred timezone
 */
function formatEventTime(dateString: string, timeZone?: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(timeZone ? { timeZone } : {}),
    }).format(date);
}

/**
 * SVG placeholder paths by game slug.
 * Supports both short registry slugs (wow, ffxiv) and full IGDB slugs (world-of-warcraft).
 */
const GAME_PLACEHOLDER_PATHS: Record<string, string> = {
    // Short registry slugs
    wow: '/placeholders/wow-placeholder.svg',
    ffxiv: '/placeholders/ffxiv-placeholder.svg',
    valheim: '/placeholders/valheim-placeholder.svg',
    // Full IGDB slugs
    'world-of-warcraft': '/placeholders/wow-placeholder.svg',
    'final-fantasy-xiv-online': '/placeholders/ffxiv-placeholder.svg',
    // Generic fallback
    generic: '/placeholders/generic-placeholder.svg',
};

/**
 * Get placeholder SVG path based on game slug.
 * Handles both IGDB full slugs and short registry slugs.
 */
function getPlaceholderPath(slug: string | undefined): string {
    if (slug && GAME_PLACEHOLDER_PATHS[slug]) {
        return GAME_PLACEHOLDER_PATHS[slug];
    }
    return GAME_PLACEHOLDER_PATHS.generic;
}

/**
 * Event card component displaying event info with game cover.
 * ROK-222: Uses resolveAvatar() for creator avatar.
 */
export const EventCard = React.memo(function EventCard({ event, signupCount = 0, onClick, matchesGameTime }: EventCardProps) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const gameCoverUrl = event.game?.coverUrl || null;
    const isCancelled = !!event.cancelledAt;
    const status: EventStatus = isCancelled ? 'cancelled' : getEventStatus(event.startTime, event.endTime);
    const relativeTime = getRelativeTime(event.startTime, event.endTime);
    const placeholderPath = getPlaceholderPath(event.game?.slug);

    // Track image load failure to show placeholder
    const [imageError, setImageError] = React.useState(false);
    const showPlaceholder = !gameCoverUrl || imageError;

    // ROK-222: Resolve creator avatar through unified pipeline
    // ROK-352: Use toAvatarUser() so current user overlay applies
    const creatorAvatar = resolveAvatar(toAvatarUser(event.creator));

    return (
        <div
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            role="button"
            tabIndex={0}
            className={`group cursor-pointer bg-surface rounded-lg border border-edge overflow-hidden hover:border-dim hover:shadow-xl focus:outline-none transition-all duration-200 ${isCancelled ? 'opacity-60 hover:shadow-red-500/10 focus:border-red-500' : 'hover:shadow-emerald-500/10 focus:border-emerald-500'}`}
        >
            {/* Game Cover */}
            <div className="aspect-[3/4] relative overflow-hidden bg-panel">
                {!showPlaceholder && gameCoverUrl && (
                    <img
                        src={gameCoverUrl}
                        alt={event.game?.name || 'Event'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={() => setImageError(true)}
                    />
                )}
                {showPlaceholder && (
                    <img
                        src={placeholderPath}
                        alt={event.game?.name || 'Gaming Event'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                )}
                {/* Game Time badge - top left */}
                {matchesGameTime && (
                    <div className="absolute top-2 left-2">
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Inside Game Time
                        </span>
                    </div>
                )}
                {/* Status Badge - top right */}
                <div className="absolute top-2 right-2">
                    <StatusBadge status={status} />
                </div>
                {event.game && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                        <span className="text-sm text-secondary">{event.game.name}</span>
                    </div>
                )}
            </div>


            {/* Event Info */}
            <div className="p-4">
                <h3 className={`font-semibold text-foreground text-lg mb-2 line-clamp-2 ${isCancelled ? 'line-through text-muted' : ''}`}>
                    {event.title}
                </h3>

                <div className="flex items-center gap-2 mb-3">
                    <p className="text-muted text-sm">
                        {formatEventTime(event.startTime, resolved)}
                    </p>
                    <span className="text-faint">&#8226;</span>
                    <p data-testid="relative-time" className="text-sm text-dim">
                        {relativeTime}
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-400 font-medium">
                        {signupCount} signed up
                    </span>

                    <div className="flex items-center gap-1">
                        {creatorAvatar.url ? (
                            <img
                                src={creatorAvatar.url}
                                alt={event.creator.username}
                                className="w-6 h-6 rounded-full bg-overlay"
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                }}
                            />
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-overlay flex items-center justify-center text-[10px] font-semibold text-muted">
                                {event.creator.username.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <span className="text-xs text-dim">
                            by {event.creator.username}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
});

/**
 * Skeleton loader for event cards during loading state
 */
export function EventCardSkeleton() {
    return (
        <div className="bg-surface rounded-lg border border-edge overflow-hidden animate-pulse">
            <div className="aspect-[3/4] bg-panel relative">
                {/* Status badge skeleton */}
                <div className="absolute top-2 right-2 w-16 h-5 bg-overlay rounded-full" />
            </div>
            <div className="p-4 space-y-3">
                <div className="h-6 bg-panel rounded w-3/4" />
                <div className="h-4 bg-panel rounded w-1/2" />
                <div className="h-4 bg-panel rounded w-1/4" />
            </div>
        </div>
    );
}
