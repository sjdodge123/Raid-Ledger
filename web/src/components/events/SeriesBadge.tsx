/**
 * Series badge indicating a recurring event.
 * Shows a repeat icon to distinguish series events from one-off events.
 */

const REPEAT_ICON = (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);

interface SeriesBadgeProps {
    /** Additional CSS classes. */
    className?: string;
    /** Show "Series" label text. Default false (icon-only). */
    showLabel?: boolean;
    /** Tooltip text. Default "Recurring series"; the roster passes "Signed up for the series" (ROK-1728). */
    title?: string;
}

/** Compact recurring-event indicator badge. */
export function SeriesBadge({ className = '', showLabel = false, title = 'Recurring series' }: SeriesBadgeProps) {
    return (
        <span
            data-testid="series-badge"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 ${className}`}
            title={title}
        >
            {REPEAT_ICON}
            {showLabel && 'Series'}
        </span>
    );
}
