import type { AvailabilityStatus } from '@raid-ledger/contract';

interface AvailabilityCellProps {
    status: AvailabilityStatus | 'none';
    gameId?: string | null;
    className?: string;
}

/**
 * Cell colors based on availability status (per UX spec ROK-113).
 */
const statusColors: Record<AvailabilityStatus | 'none', string> = {
    available: 'bg-emerald-500/80 hover:bg-emerald-400',
    committed: 'bg-blue-500/80 hover:bg-blue-400',
    blocked: 'bg-dim/80 hover:bg-muted',
    freed: 'bg-emerald-500/50 border-2 border-dashed border-emerald-400',
    none: 'bg-panel/50',
};

const statusIcons: Record<AvailabilityStatus | 'none', string | null> = {
    available: null,
    committed: '📅',
    blocked: '🔒',
    freed: '🔓',
    none: null,
};

/**
 * Individual cell in the heatmap grid.
 * Displays availability status with appropriate color and icon.
 */
export function AvailabilityCell({ status, className = '' }: AvailabilityCellProps) {
    const icon = statusIcons[status];

    return (
        <div
            className={`
                h-8 w-full rounded-sm transition-colors duration-150
                flex items-center justify-center text-xs
                ${statusColors[status]}
                ${className}
            `}
            title={status}
        >
            {icon && <span className="opacity-80">{icon}</span>}
        </div>
    );
}
