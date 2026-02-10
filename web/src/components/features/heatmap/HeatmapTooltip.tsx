import type { AvailabilityStatus } from '@raid-ledger/contract';

interface HeatmapTooltipProps {
    username: string;
    status: AvailabilityStatus | 'none';
    timeRange: { start: string; end: string };
    position: { x: number; y: number };
}

const statusLabels: Record<AvailabilityStatus | 'none', string> = {
    available: 'Available',
    committed: 'Committed to Event',
    blocked: 'Blocked',
    freed: 'Freed (Event Cancelled)',
    none: 'No Availability Set',
};

/**
 * Tooltip displayed on heatmap cell hover.
 */
export function HeatmapTooltip({ username, status, timeRange, position }: HeatmapTooltipProps) {
    const formatTime = (isoString: string) =>
        new Date(isoString).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
        });

    return (
        <div
            className="fixed z-50 pointer-events-none"
            style={{
                left: position.x + 10,
                top: position.y + 10,
            }}
        >
            <div className="bg-surface border border-edge-strong rounded-lg shadow-xl px-3 py-2 max-w-xs">
                <p className="font-medium text-foreground text-sm">{username}</p>
                <p className="text-secondary text-xs mt-1">{statusLabels[status]}</p>
                <p className="text-muted text-xs mt-1">
                    {formatTime(timeRange.start)} - {formatTime(timeRange.end)}
                </p>
            </div>
        </div>
    );
}
