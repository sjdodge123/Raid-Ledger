import { useCallback, useEffect, useState, useMemo } from 'react';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
import type { GridDims } from './game-time-grid.types';
import { DAYS, ALL_HOURS, CELL_GAP } from './game-time-grid.utils';

/** Builds a slot lookup map keyed by "dayOfWeek:hour" */
function buildSlotMap(slots: GameTimeSlot[]): Map<string, GameTimeSlot> {
    const map = new Map<string, GameTimeSlot>();
    for (const slot of slots) map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
    return map;
}

/** Builds a set of "dayOfWeek:hour" keys covered by event blocks */
function buildEventCellSet(events: GameTimeEventBlock[]): Set<string> {
    const set = new Set<string>();
    for (const ev of events) { for (let h = ev.startHour; h < ev.endHour; h++) set.add(`${ev.dayOfWeek}:${h}`); }
    return set;
}

/** Builds lookup maps from slots and events */
export function useSlotMaps(
    slots: GameTimeSlot[], events?: GameTimeEventBlock[],
): {
    slotMap: Map<string, GameTimeSlot>;
    eventCellSet: Set<string>;
} {
    const slotMap = useMemo(() => buildSlotMap(slots), [slots]);
    const eventCellSet = useMemo(() => events ? buildEventCellSet(events) : new Set<string>(), [events]);
    return { slotMap, eventCellSet };
}

/** Computes date labels for the displayed week */
export function useWeekDates(weekStart?: string): { dayDates: string[] | null } {
    const dayDates = useMemo(() => parseDayDates(weekStart), [weekStart]);
    return { dayDates };
}

/** Parses a weekStart ISO string into "M/D" labels for its seven days */
function parseDayDates(weekStart: string | undefined): string[] | null {
    if (!weekStart) return null;
    const [dateStr = weekStart] = weekStart.split('T');
    const [y = NaN, m = NaN, d = NaN] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const base = new Date(y, m - 1, d);
    return DAYS.map((_, i) => { const dt = new Date(base); dt.setDate(base.getDate() + i); return `${dt.getMonth() + 1}/${dt.getDate()}`; });
}

/** Events to draw as overlay blocks (none when the grid has no events) */
export function useDisplayEvents(events?: GameTimeEventBlock[]): GameTimeEventBlock[] {
    return useMemo(() => events ?? [], [events]);
}

/** Measures grid cell from DOM and creates a ResizeObserver */
function measureGrid(el: HTMLElement, rangeStart: number): GridDims | null {
    const firstCell = el.querySelector(`[data-testid="cell-0-${rangeStart}"]`) ?? el.querySelector(`[data-testid^="cell-0-"]`);
    if (!firstCell || !(firstCell instanceof HTMLElement)) return null;
    const allCells = el.querySelectorAll('[data-testid^="cell-0-"]');
    let rowHeight = firstCell.offsetHeight + CELL_GAP;
    if (allCells.length >= 2) {
        // Row pitch straight from the DOM beats offsetHeight + gap, but only when
        // the two rows actually report distinct offsets. A zero diff means the
        // grid has not been laid out yet, so keep the fallback rather than
        // publishing a rowHeight of 0.
        const pitch = (allCells[1] as HTMLElement).offsetTop - (allCells[0] as HTMLElement).offsetTop;
        if (pitch > 0) rowHeight = pitch;
    }
    return { colWidth: firstCell.offsetWidth, rowHeight, headerHeight: el.offsetTop + firstCell.offsetTop, colStartLeft: el.offsetLeft + firstCell.offsetLeft };
}

/** Grid dimension measurement via ResizeObserver */
export function useGridMeasurement(
    gridRef: React.RefObject<HTMLDivElement | null>,
    wrapperRef: React.RefObject<HTMLDivElement | null>,
    needsMeasurement: boolean, rangeStart: number, rangeEnd: number,
): GridDims | null {
    const [gridDims, setGridDims] = useState<GridDims | null>(null);
    useEffect(() => {
        const el = gridRef.current;
        if (!el || !wrapperRef.current || !needsMeasurement) return;
        // A measurement taken before layout settles reads every box as 0, and a
        // zero rowHeight makes the editor silently inert: DayTarget divides by it
        // to find the tapped row, gets Infinity, fails its bounds check and drops
        // the tap. Hold gridDims at null instead, so the block layer simply does
        // not mount until the grid has real dimensions.
        const doMeasure = () => {
            const dims = measureGrid(el, rangeStart);
            if (dims && dims.rowHeight > 0 && dims.colWidth > 0) setGridDims(dims);
        };
        doMeasure();
        const observer = new ResizeObserver(doMeasure);
        observer.observe(el);
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
    }, [needsMeasurement, rangeStart, rangeEnd]);
    return gridDims;
}

/** Returns the slot status for a cell */
export function useSlotStatus(slotMap: Map<string, GameTimeSlot>): (day: number, hour: number) => string | undefined {
    return useCallback((day: number, hour: number): string | undefined => slotMap.get(`${day}:${hour}`)?.status, [slotMap]);
}

/** Returns whether a cell is locked (committed/blocked) */
export function useCellLocked(getSlotStatus: (d: number, h: number) => string | undefined): (d: number, h: number) => boolean {
    return useCallback(
        (day: number, hour: number): boolean => {
            const status = getSlotStatus(day, hour);
            return status === 'committed' || status === 'blocked';
        },
        [getSlotStatus],
    );
}

/**
 * Read-only slot view: status and locked-ness for a cell.
 *
 * Drag-to-paint lived here until ROK-1426; availability is now edited as blocks
 * (see use-block-editor.ts), so nothing in this hook mutates slots. The rolling
 * next-week view and its past-cell handling went with TDB:1933.
 */
export function useSlotView(slotMap: Map<string, GameTimeSlot>): {
    getSlotStatus: (d: number, h: number) => string | undefined;
    isCellLocked: (d: number, h: number) => boolean;
} {
    const getSlotStatus = useSlotStatus(slotMap);
    const isCellLocked = useCellLocked(getSlotStatus);
    return { getSlotStatus, isCellLocked };
}

/** Computes the radial gradient background for hover glow effect */
export function useHoverGlow(
    hoverDay: number, hoverHour: number,
    gridDims: GridDims | null, isInteractive: boolean, rangeStart: number,
): string | undefined {
    return useMemo(() => {
        if (hoverDay < 0 || !gridDims || !isInteractive) return undefined;
        const x = gridDims.colStartLeft + hoverDay * (gridDims.colWidth + CELL_GAP) + gridDims.colWidth / 2;
        const y = gridDims.headerHeight + (hoverHour - rangeStart) * gridDims.rowHeight + gridDims.rowHeight / 2;
        return `radial-gradient(circle 100px at ${x}px ${y}px, var(--gt-hover-glow), transparent 80%)`;
    }, [hoverDay, hoverHour, gridDims, isInteractive, rangeStart]);
}

/** Visible hours filtered by range */
export function useVisibleHours(hourRange?: [number, number]): { HOURS: number[]; rangeStart: number; rangeEnd: number } {
    const [rangeStart, rangeEnd] = hourRange ?? [0, 24];
    const HOURS = useMemo(() => {
        if (rangeStart < rangeEnd) return ALL_HOURS.filter((h) => h >= rangeStart && h < rangeEnd);
        // Wrapping range (e.g. [9, 2] = 9 AM → 1 AM): show rangeStart..23 then 0..rangeEnd-1
        return [...ALL_HOURS.filter((h) => h >= rangeStart), ...ALL_HOURS.filter((h) => h < rangeEnd)];
    }, [rangeStart, rangeEnd]);
    return { HOURS, rangeStart, rangeEnd };
}

export { useScrollDirection };
