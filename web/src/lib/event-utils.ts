export type EventStatus = 'upcoming' | 'live' | 'ended';

/** EventStatus extended with 'cancelled' for display purposes */
export type EventDisplayStatus = EventStatus | 'cancelled';

export const STATUS_STYLES: Record<EventDisplayStatus, string> = {
    upcoming: 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30',
    live: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
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

function pluralize(n: number, unit: string): string {
    return `${n} ${n === 1 ? unit : `${unit}s`}`;
}

function getLiveRelativeTime(now: Date, start: Date): string {
    const elapsedMins = Math.round((now.getTime() - start.getTime()) / 60000);
    if (elapsedMins < 1) return 'just started';
    if (elapsedMins < 60) return `started ${pluralize(elapsedMins, 'minute')} ago`;
    return `started ${pluralize(Math.round(elapsedMins / 60), 'hour')} ago`;
}

function getEndedRelativeTime(now: Date, end: Date): string {
    const diffMs = now.getTime() - end.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays >= 1) return `ended ${pluralize(diffDays, 'day')} ago`;
    if (diffHours >= 1) return `ended ${pluralize(diffHours, 'hour')} ago`;
    if (diffMins < 1) return 'just ended';
    return `ended ${pluralize(diffMins, 'minute')} ago`;
}

function getUpcomingRelativeTime(now: Date, start: Date): string {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
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
 * Get relative time string (e.g., "in 2 hours", "started 30 min ago")
 */
export function getRelativeTime(startTime: string, endTime: string): string {
    const now = new Date();
    const status = getEventStatus(startTime, endTime);
    if (status === 'live') return getLiveRelativeTime(now, new Date(startTime));
    if (status === 'ended') return getEndedRelativeTime(now, new Date(endTime));
    return getUpcomingRelativeTime(now, new Date(startTime));
}
