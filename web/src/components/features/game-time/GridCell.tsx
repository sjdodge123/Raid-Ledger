import type { JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { getCellClasses, getVisualGroup } from './game-time-grid.utils';
import { computeRounding, neighborGroup, computeShadows, computeHeatmapBg, computeCellClasses, computeCellStyle } from './grid-cell.utils';

interface GridCellProps {
    dayIndex: number;
    hour: number;
    rangeStart: number;
    rangeEnd: number;
    compact?: boolean;
    getSlotStatus: (d: number, h: number) => string | undefined;
    isCellLocked: (d: number, h: number) => boolean;
    isPastCell: (d: number, h: number) => boolean;
    eventCellSet: Set<string>;
    heatmapMap: Map<string, { available: number; total: number }> | null;
    hoveredCell: string | null;
    hoverDay: number;
    hoverHour: number;
    isInteractive: boolean;
    nextWeekSlotMap: Map<string, GameTimeSlot> | null;
    onCellClick?: (d: number, h: number) => void;
    onPointerDown: (d: number, h: number) => void;
    onPointerEnter: (d: number, h: number) => void;
}

/** Single cell in the game-time grid */
export function GridCell({
    dayIndex, hour, rangeStart, rangeEnd, compact, getSlotStatus, isCellLocked,
    isPastCell, eventCellSet, heatmapMap, hoveredCell, hoverDay, hoverHour,
    isInteractive, nextWeekSlotMap, onCellClick, onPointerDown, onPointerEnter,
}: GridCellProps): JSX.Element {
    const vis = computeVisuals(dayIndex, hour, rangeStart, rangeEnd, getSlotStatus, eventCellSet, heatmapMap, hoveredCell, hoverDay, hoverHour, isInteractive, isCellLocked);
    const className = computeCellClasses(compact, vis.rounding, vis.cellClasses, vis.heatmapBg, isInteractive && !vis.locked, !!onCellClick, vis.locked, isPastCell(dayIndex, hour), !!nextWeekSlotMap, vis.isHovered, isInteractive);
    const style = computeCellStyle(vis.shadows, vis.heatmapBg);

    return (
        <div
            className={className} style={style}
            data-testid={`cell-${dayIndex}-${hour}`}
            data-status={getSlotStatus(dayIndex, hour) ?? 'inactive'}
            title={vis.heatmapData ? `${vis.heatmapData.available} of ${vis.heatmapData.total} players available` : undefined}
            onPointerDown={() => onPointerDown(dayIndex, hour)}
            onPointerEnter={() => onPointerEnter(dayIndex, hour)}
            onClick={onCellClick ? () => onCellClick(dayIndex, hour) : undefined}
        />
    );
}

/** Computes visual state: rounding, shadows, heatmap, hover */
function computeVisuals(
    dayIndex: number, hour: number, rangeStart: number, rangeEnd: number,
    getSlotStatus: (d: number, h: number) => string | undefined,
    eventCellSet: Set<string>,
    heatmapMap: Map<string, { available: number; total: number }> | null,
    hoveredCell: string | null, hoverDay: number, hoverHour: number,
    isInteractive: boolean, isCellLocked: (d: number, h: number) => boolean,
) {
    const status = getSlotStatus(dayIndex, hour);
    const locked = isCellLocked(dayIndex, hour);
    const hasOverlay = eventCellSet.has(`${dayIndex}:${hour}`);
    const group = getVisualGroup(status, hasOverlay);
    const aboveGroup = neighborGroup(dayIndex, hour - 1, rangeStart, rangeEnd, getSlotStatus, eventCellSet);
    const belowGroup = neighborGroup(dayIndex, hour + 1, rangeStart, rangeEnd, getSlotStatus, eventCellSet);
    const rounding = computeRounding(group, aboveGroup, belowGroup);
    const heatmapData = heatmapMap?.get(`${dayIndex}:${hour}`);
    const heatmapBg = computeHeatmapBg(heatmapData);
    const isHovered = hoveredCell === `${dayIndex}:${hour}`;
    const dist = hoverDay >= 0 ? Math.max(Math.abs(dayIndex - hoverDay), Math.abs(hour - hoverHour)) : Infinity;
    const shadows = computeShadows(aboveGroup === group, group, isInteractive, dist, isHovered, locked, status === 'available');
    const cellClasses = getCellClasses(status, hasOverlay);
    return { rounding, heatmapData, heatmapBg, isHovered, shadows, cellClasses, locked };
}
