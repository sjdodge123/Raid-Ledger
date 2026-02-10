import type { AvailabilityDto } from '@raid-ledger/contract';

interface AvailabilityCardProps {
    availability: AvailabilityDto;
    onEdit?: (availability: AvailabilityDto) => void;
    onDelete?: (id: string) => void;
}

const STATUS_STYLES = {
    available: {
        bg: 'bg-emerald-500/20',
        border: 'border-emerald-500/50',
        text: 'text-emerald-400',
        label: 'Available',
    },
    committed: {
        bg: 'bg-blue-500/20',
        border: 'border-blue-500/50',
        text: 'text-blue-400',
        label: 'Committed',
    },
    blocked: {
        bg: 'bg-red-500/20',
        border: 'border-red-500/50',
        text: 'text-red-400',
        label: 'Blocked',
    },
    freed: {
        bg: 'bg-amber-500/20',
        border: 'border-amber-500/50',
        text: 'text-amber-400',
        label: 'Freed',
    },
} as const;

function formatTimeRange(start: string, end: string): string {
    const startDate = new Date(start);
    const endDate = new Date(end);

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });

    const isSameDay = startDate.toDateString() === endDate.toDateString();

    if (isSameDay) {
        return `${dateFormatter.format(startDate)}, ${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
    }

    return `${dateFormatter.format(startDate)} ${timeFormatter.format(startDate)} - ${dateFormatter.format(endDate)} ${timeFormatter.format(endDate)}`;
}

/**
 * Card component for displaying a single availability window.
 */
export function AvailabilityCard({ availability, onEdit, onDelete }: AvailabilityCardProps) {
    const style = STATUS_STYLES[availability.status];

    return (
        <div
            className={`${style.bg} ${style.border} border rounded-lg p-4 transition-all hover:shadow-lg`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    {/* Status Badge */}
                    <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text} border ${style.border} mb-2`}
                    >
                        {style.label}
                    </span>

                    {/* Time Range */}
                    <p className="text-foreground font-medium text-sm">
                        {formatTimeRange(availability.timeRange.start, availability.timeRange.end)}
                    </p>

                    {/* Game indicator (if game-specific) */}
                    {availability.gameId && (
                        <p className="text-muted text-xs mt-1">
                            Game-specific availability
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    {onEdit && (
                        <button
                            onClick={() => onEdit(availability)}
                            className="p-1.5 text-muted hover:text-foreground hover:bg-overlay rounded transition-colors"
                            title="Edit"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={() => onDelete(availability.id)}
                            className="p-1.5 text-muted hover:text-red-400 hover:bg-overlay rounded transition-colors"
                            title="Delete"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
