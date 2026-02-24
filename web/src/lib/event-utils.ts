export type EventStatus = 'upcoming' | 'live' | 'ended';

/** EventStatus extended with 'cancelled' for display purposes */
export type EventDisplayStatus = EventStatus | 'cancelled';

export const STATUS_STYLES: Record<EventDisplayStatus, string> = {
    upcoming: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    live: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    ended: 'bg-dim/20 text-muted border-dim/30',
    cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export const STATUS_LABELS: Record<EventDisplayStatus, string> = {
    upcoming: 'Upcoming',
    live: 'Live',
    ended: 'Ended',
    cancelled: 'Cancelled',
};

/**
 * Format date/time in user's preferred timezone
 */
export function formatEventTime(dateString: string, timeZone?: string): string {
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
