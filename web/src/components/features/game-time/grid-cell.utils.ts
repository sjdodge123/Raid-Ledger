import { getVisualGroup, getMergeColor } from './game-time-grid.utils';

/** Computes the vertical merge rounding class for a cell */
export function computeRounding(
    group: string, aboveGroup: string | null, belowGroup: string | null,
): string {
    const sameAbove = aboveGroup === group;
    const sameBelow = belowGroup === group;
    if (sameAbove && sameBelow) return '';
    if (sameAbove) return 'rounded-b-sm';
    if (sameBelow) return 'rounded-t-sm';
    return 'rounded-sm';
}

/** Computes the visual group for a neighbor cell, or null if out of range */
export function neighborGroup(
    dayIndex: number, neighborHour: number, rangeStart: number, rangeEnd: number,
    getSlotStatus: (d: number, h: number) => string | undefined,
    eventCellSet: Set<string>,
): string | null {
    if (neighborHour < rangeStart || neighborHour >= rangeEnd) return null;
    return getVisualGroup(getSlotStatus(dayIndex, neighborHour), eventCellSet.has(`${dayIndex}:${neighborHour}`));
}

/** Builds the box-shadow array for a grid cell */
export function computeShadows(
    sameAbove: boolean, group: string, isInteractive: boolean,
    dist: number, isHovered: boolean, locked: boolean, isErase: boolean,
): string[] {
    const shadows: string[] = [];
    if (sameAbove) shadows.push(`0 -1px 0 0 ${getMergeColor(group)}`);
    if (isInteractive && dist > 0 && dist <= 4) {
        shadows.push(`inset 0 0 0 0.5px rgba(var(--gt-proximity-line), ${(0.28 - (dist - 1) * 0.06).toFixed(2)})`);
    }
    if (isHovered && isInteractive) {
        if (locked) {
            shadows.push(`0 0 0 1.5px rgba(var(--gt-proximity-line), 0.5)`);
            shadows.push(`0 0 10px 1px rgba(var(--gt-proximity-line), 0.25)`);
        } else {
            const ringColor = isErase ? 'rgba(248, 113, 113, 0.9)' : 'rgba(52, 211, 153, 0.95)';
            shadows.push(`0 0 0 2px ${ringColor}`);
            shadows.push(isErase ? '0 0 16px 2px rgba(248, 113, 113, 0.55)' : '0 0 16px 2px rgba(52, 211, 153, 0.6)');
        }
    }
    return shadows;
}

/** Computes the heatmap background color for a cell, or undefined if no data */
export function computeHeatmapBg(
    heatmapData: { available: number; total: number } | undefined,
): string | undefined {
    if (!heatmapData) return undefined;
    const intensity = heatmapData.available / heatmapData.total;
    if (intensity >= 1.0) return `rgba(34, 197, 94, ${(0.3 + intensity * 0.35).toFixed(2)})`;
    if (intensity > 0.5) return `rgba(234, 179, 8, ${(0.25 + intensity * 0.35).toFixed(2)})`;
    return `rgba(239, 68, 68, ${(0.2 + intensity * 0.35).toFixed(2)})`;
}

/** Computes cursor and conditional classes for a grid cell */
export function computeCellClasses(
    compact: boolean | undefined, rounding: string, cellClasses: string,
    heatmapBg: string | undefined, canInteract: boolean, clickable: boolean,
    locked: boolean, past: boolean, hasNextWeek: boolean,
    isHovered: boolean, isInteractive: boolean,
): string {
    const cursorClass = canInteract || clickable ? 'cursor-pointer' : locked ? 'cursor-not-allowed' : '';
    const pastClass = past && hasNextWeek && !isHovered ? 'opacity-60' : '';
    const hoverClass = isHovered && (isInteractive || clickable) ? 'z-10 relative' : '';
    return `${compact ? 'h-4' : 'h-5'} ${rounding} transition-colors ${heatmapBg ? '' : cellClasses} ${cursorClass} ${pastClass} ${hoverClass}`;
}

/** Builds the inline style object for a grid cell */
export function computeCellStyle(shadows: string[], heatmapBg: string | undefined): React.CSSProperties | undefined {
    const obj: React.CSSProperties = { ...(shadows.length ? { boxShadow: shadows.join(', ') } : {}), ...(heatmapBg ? { backgroundColor: heatmapBg } : {}) };
    return Object.keys(obj).length ? obj : undefined;
}
