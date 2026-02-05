import React from 'react';
import type { EventResponseDto } from '@raid-ledger/contract';

interface EventCardProps {
    event: EventResponseDto;
    signupCount?: number;
    onClick?: () => void;
}

type EventStatus = 'upcoming' | 'live' | 'ended';

/**
 * Determine event status based on current time vs start/end times
 */
export function getEventStatus(startTime: string, endTime: string): EventStatus {
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (now < start) return 'upcoming';
    if (now >= start && now <= end) return 'live';
    return 'ended';
}

/**
 * Get relative time string (e.g., "in 2 hours", "started 30 min ago")
 */
export function getRelativeTime(startTime: string, endTime: string): string {
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    const status = getEventStatus(startTime, endTime);

    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    if (status === 'live') {
        const elapsedMins = Math.round((now.getTime() - start.getTime()) / 60000);
        if (elapsedMins < 1) return 'just started';
        if (elapsedMins < 60) return `started ${elapsedMins} ${elapsedMins === 1 ? 'minute' : 'minutes'} ago`;
        const elapsedHours = Math.round(elapsedMins / 60);
        return `started ${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} ago`;
    }

    if (status === 'ended') {
        const diffMs = now.getTime() - end.getTime();
        const diffMins = Math.round(diffMs / 60000);
        const diffHours = Math.round(diffMs / 3600000);
        const diffDays = Math.round(diffMs / 86400000);
        if (diffDays >= 1) return `ended ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
        if (diffHours >= 1) return `ended ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
        if (diffMins < 1) return 'just ended';
        return `ended ${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    }

    // Upcoming - use Intl for natural language
    const diffMs = start.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMins < 1) return 'starting now';
    if (diffDays >= 1) return rtf.format(diffDays, 'day');
    if (diffHours >= 1) return rtf.format(diffHours, 'hour');
    return rtf.format(diffMins, 'minute');
}

/**
 * Status badge component with color coding
 */
function StatusBadge({ status }: { status: EventStatus }) {
    const styles: Record<EventStatus, string> = {
        upcoming: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        live: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        ended: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };

    const labels: Record<EventStatus, string> = {
        upcoming: 'Upcoming',
        live: '● Live',
        ended: 'Ended',
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
 * Format date/time in user's local timezone
 */
function formatEventTime(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

/**
 * SVG placeholder paths by game slug
 */
const GAME_PLACEHOLDER_PATHS: Record<string, string> = {
    wow: '/placeholders/wow-placeholder.svg',
    ffxiv: '/placeholders/ffxiv-placeholder.svg',
    valheim: '/placeholders/valheim-placeholder.svg',
    generic: '/placeholders/generic-placeholder.svg',
};

/**
 * Get placeholder SVG path based on game slug
 */
function getPlaceholderPath(slug: string | undefined): string {
    if (slug && GAME_PLACEHOLDER_PATHS[slug]) {
        return GAME_PLACEHOLDER_PATHS[slug];
    }
    return GAME_PLACEHOLDER_PATHS.generic;
}

/**
 * Event card component displaying event info with game cover
 */
export function EventCard({ event, signupCount = 0, onClick }: EventCardProps) {
    const gameCoverUrl = event.game?.coverUrl || null;
    const status = getEventStatus(event.startTime, event.endTime);
    const relativeTime = getRelativeTime(event.startTime, event.endTime);
    const placeholderPath = getPlaceholderPath(event.game?.slug);

    // Track image load failure to show placeholder
    const [imageError, setImageError] = React.useState(false);
    const showPlaceholder = !gameCoverUrl || imageError;

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
            className="group cursor-pointer bg-slate-900 rounded-lg border border-slate-700 overflow-hidden hover:border-slate-500 hover:shadow-xl hover:shadow-emerald-500/10 focus:border-emerald-500 focus:outline-none transition-all duration-200"
        >
            {/* Game Cover */}
            <div className="aspect-[3/4] relative overflow-hidden bg-slate-800">
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
                {/* Status Badge - top right */}
                <div className="absolute top-2 right-2">
                    <StatusBadge status={status} />
                </div>
                {event.game && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                        <span className="text-sm text-slate-300">{event.game.name}</span>
                    </div>
                )}
            </div>


            {/* Event Info */}
            <div className="p-4">
                <h3 className="font-semibold text-white text-lg mb-2 line-clamp-2">
                    {event.title}
                </h3>

                <div className="flex items-center gap-2 mb-3">
                    <p className="text-slate-400 text-sm">
                        {formatEventTime(event.startTime)}
                    </p>
                    <span className="text-slate-600">•</span>
                    <p data-testid="relative-time" className="text-sm text-slate-500">
                        {relativeTime}
                    </p>
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-400 font-medium">
                        {signupCount} signed up
                    </span>

                    <div className="flex items-center gap-1">
                        <img
                            src={event.creator.avatar || '/default-avatar.png'}
                            alt={event.creator.username}
                            className="w-6 h-6 rounded-full bg-slate-700"
                            onError={(e) => {
                                e.currentTarget.src = '/default-avatar.png';
                            }}
                        />
                        <span className="text-xs text-slate-500">
                            by {event.creator.username}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Skeleton loader for event cards during loading state
 */
export function EventCardSkeleton() {
    return (
        <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden animate-pulse">
            <div className="aspect-[3/4] bg-slate-800 relative">
                {/* Status badge skeleton */}
                <div className="absolute top-2 right-2 w-16 h-5 bg-slate-700 rounded-full" />
            </div>
            <div className="p-4 space-y-3">
                <div className="h-6 bg-slate-800 rounded w-3/4" />
                <div className="h-4 bg-slate-800 rounded w-1/2" />
                <div className="h-4 bg-slate-800 rounded w-1/4" />
            </div>
        </div>
    );
}
