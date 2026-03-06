export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
export const CELL_GAP = 1; // gap-px = 1px between grid cells

export function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function formatTooltip(dayIndex: number, hour: number, status?: string, dateLabel?: string): string {
    const dayName = FULL_DAYS[dayIndex];
    const startStr = formatHour(hour);
    const endStr = formatHour((hour + 1) % 24);
    const statusLabel = status && status !== 'available' ? ` — ${status.charAt(0).toUpperCase() + status.slice(1)}` : '';
    const datePart = dateLabel ? ` ${dateLabel}` : '';
    return `${dayName}${datePart} ${startStr} – ${endStr}${statusLabel}`;
}

export function getCellClasses(status?: string, hasEventOverlay?: boolean): string {
    switch (status) {
        case 'available':
            return 'bg-emerald-500/70';
        case 'committed':
            return hasEventOverlay ? 'bg-overlay/30' : 'bg-blue-500/70';
        case 'blocked':
            return 'bg-red-500/50';
        case 'freed':
            return 'bg-emerald-500/40 border border-dashed border-emerald-400';
        default:
            return 'bg-panel/50';
    }
}

/** Visual group key — cells with the same key merge (share border-radius edges) */
export function getVisualGroup(status?: string, hasEventOverlay?: boolean): string {
    if (!status) return 'inactive';
    if (status === 'committed' && hasEventOverlay) return 'committed-overlay';
    return status;
}

/** Box-shadow color used to fill the 1px grid gap between merged cells */
export function getMergeColor(group: string): string {
    switch (group) {
        case 'available': return 'rgba(16, 185, 129, 0.7)';
        case 'committed': return 'rgba(59, 130, 246, 0.7)';
        case 'committed-overlay': return 'rgba(51, 65, 85, 0.3)';
        case 'blocked': return 'rgba(239, 68, 68, 0.5)';
        case 'freed': return 'rgba(16, 185, 129, 0.4)';
        default: return 'var(--gt-split-bg)';
    }
}
