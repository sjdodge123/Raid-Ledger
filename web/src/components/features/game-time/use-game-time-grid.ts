import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
import type { GridDims, HeatmapCell } from './game-time-grid.types';
import { DAYS, ALL_HOURS, CELL_GAP } from './game-time-grid.utils';

/** Builds a slot lookup map keyed by "dayOfWeek:hour" */
function buildSlotMap(slots: GameTimeSlot[]): Map<string, GameTimeSlot> {
    const map = new Map<string, GameTimeSlot>();
    for (const slot of slots) map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
    return map;
}

/** Builds a heatmap lookup map keyed by "dayOfWeek:hour" */
function buildHeatmapMap(cells: HeatmapCell[]): Map<string, { available: number; total: number }> {
    const map = new Map<string, { available: number; total: number }>();
    for (const cell of cells) map.set(`${cell.dayOfWeek}:${cell.hour}`, { available: cell.availableCount, total: cell.totalCount });
    return map;
}

/** Builds a set of "dayOfWeek:hour" keys covered by event blocks */
function buildEventCellSet(events: GameTimeEventBlock[]): Set<string> {
    const set = new Set<string>();
    for (const ev of events) { for (let h = ev.startHour; h < ev.endHour; h++) set.add(`${ev.dayOfWeek}:${h}`); }
    return set;
}

/** Builds lookup maps from slots, next-week slots, heatmap, and events */
export function useSlotMaps(
    slots: GameTimeSlot[], nextWeekSlots?: GameTimeSlot[],
    heatmapOverlay?: HeatmapCell[], events?: GameTimeEventBlock[],
): {
    slotMap: Map<string, GameTimeSlot>;
    nextWeekSlotMap: Map<string, GameTimeSlot> | null;
    heatmapMap: Map<string, { available: number; total: number }> | null;
    eventCellSet: Set<string>;
} {
    const slotMap = useMemo(() => buildSlotMap(slots), [slots]);
    const nextWeekSlotMap = useMemo(() => nextWeekSlots ? buildSlotMap(nextWeekSlots) : null, [nextWeekSlots]);
    const heatmapMap = useMemo(() => heatmapOverlay ? buildHeatmapMap(heatmapOverlay) : null, [heatmapOverlay]);
    const eventCellSet = useMemo(() => events ? buildEventCellSet(events) : new Set<string>(), [events]);
    return { slotMap, nextWeekSlotMap, heatmapMap, eventCellSet };
}

/** Computes date labels for the displayed week and the next rolling week */
export function useWeekDates(weekStart?: string): { dayDates: string[] | null; nextWeekDayDates: string[] | null } {
    const dayDates = useMemo(() => parseDayDates(weekStart, 0), [weekStart]);
    const nextWeekDayDates = useMemo(() => parseDayDates(weekStart, 7), [weekStart]);
    return { dayDates, nextWeekDayDates };
}

/** Parses a weekStart ISO string into "M/D" labels offset by the given number of days */
function parseDayDates(weekStart: string | undefined, offsetDays: number): string[] | null {
    if (!weekStart) return null;
    const dateStr = weekStart.split('T')[0];
    const [y, m, d] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    const base = new Date(y, m - 1, d);
    base.setDate(base.getDate() + offsetDays);
    return DAYS.map((_, i) => { const dt = new Date(base); dt.setDate(base.getDate() + i); return `${dt.getMonth() + 1}/${dt.getDate()}`; });
}

/** Filters current and next-week events for rolling display */
function filterDisplayEvents(
    events: GameTimeEventBlock[] | undefined, nextWeekEvents: GameTimeEventBlock[] | undefined,
    todayIndex: number | undefined, currentHour: number | undefined,
): GameTimeEventBlock[] {
    if (!events) return [];
    if (!nextWeekEvents) return events;
    const nowHour = currentHour !== undefined ? Math.floor(currentHour) : undefined;
    const result: GameTimeEventBlock[] = [];
    for (const ev of events) {
        if (todayIndex === undefined) { result.push(ev); continue; }
        if (ev.dayOfWeek < todayIndex) continue;
        if (ev.dayOfWeek === todayIndex && nowHour !== undefined && ev.endHour <= nowHour) continue;
        result.push(ev);
    }
    if (nextWeekEvents && todayIndex !== undefined) {
        for (const ev of nextWeekEvents) {
            if (ev.dayOfWeek < todayIndex) result.push(ev);
            else if (ev.dayOfWeek === todayIndex && nowHour !== undefined && ev.endHour <= nowHour) result.push(ev);
        }
    }
    return result;
}

/** Filters events for display in rolling-week mode */
export function useDisplayEvents(
    events?: GameTimeEventBlock[], nextWeekEvents?: GameTimeEventBlock[],
    todayIndex?: number, currentHour?: number,
): GameTimeEventBlock[] {
    return useMemo(() => filterDisplayEvents(events, nextWeekEvents, todayIndex, currentHour), [events, nextWeekEvents, todayIndex, currentHour]);
}

/** Measures grid cell from DOM and creates a ResizeObserver */
function measureGrid(el: HTMLElement, rangeStart: number): GridDims | null {
    const firstCell = el.querySelector(`[data-testid="cell-0-${rangeStart}"]`) ?? el.querySelector(`[data-testid^="cell-0-"]`);
    if (!firstCell || !(firstCell instanceof HTMLElement)) return null;
    const allCells = el.querySelectorAll('[data-testid^="cell-0-"]');
    let rowHeight = firstCell.offsetHeight + CELL_GAP;
    if (allCells.length >= 2) {
        rowHeight = (allCells[1] as HTMLElement).offsetTop - (allCells[0] as HTMLElement).offsetTop;
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
        const doMeasure = () => { const dims = measureGrid(el, rangeStart); if (dims) setGridDims(dims); };
        doMeasure();
        const observer = new ResizeObserver(doMeasure);
        observer.observe(el);
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
    }, [needsMeasurement, rangeStart, rangeEnd]);
    return gridDims;
}

/** Returns whether a cell is in the "past" portion of the rolling week */
export function useIsPastCell(todayIndex?: number, currentHour?: number): (day: number, hour: number) => boolean {
    return useCallback(
        (dayIndex: number, hour: number): boolean => {
            if (todayIndex === undefined || currentHour === undefined) return false;
            return dayIndex < todayIndex || (dayIndex === todayIndex && hour < Math.floor(currentHour));
        },
        [todayIndex, currentHour],
    );
}

/** Returns the resolved slot status accounting for rolling week dirty cells */
export function useSlotStatus(
    slotMap: Map<string, GameTimeSlot>, nextWeekSlotMap: Map<string, GameTimeSlot> | null,
    isPastCell: (d: number, h: number) => boolean, dirtyCells: ReadonlySet<string>,
): (day: number, hour: number) => string | undefined {
    return useCallback(
        (day: number, hour: number): string | undefined => {
            const key = `${day}:${hour}`;
            if (nextWeekSlotMap && isPastCell(day, hour)) {
                if (dirtyCells.has(key)) return slotMap.get(key)?.status;
                return nextWeekSlotMap.get(key)?.status;
            }
            return slotMap.get(key)?.status;
        },
        [slotMap, nextWeekSlotMap, isPastCell, dirtyCells],
    );
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

/** Toggle cell between paint/erase mode */
function useToggleCell(
    slots: GameTimeSlot[], slotMap: Map<string, GameTimeSlot>,
    onChange: ((slots: GameTimeSlot[]) => void) | undefined,
    isCellLocked: (d: number, h: number) => boolean,
    setDirtyCells: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
): (day: number, hour: number, mode: 'paint' | 'erase') => void {
    return useCallback(
        (day: number, hour: number, mode: 'paint' | 'erase') => {
            if (!onChange || isCellLocked(day, hour)) return;
            const key = `${day}:${hour}`;
            setDirtyCells(prev => { const next = new Set(prev); next.add(key); return next; });
            const existing = slotMap.get(key);
            if (mode === 'paint' && !existing) onChange([...slots, { dayOfWeek: day, hour, status: 'available' }]);
            else if (mode === 'erase' && existing?.status === 'available') onChange(slots.filter((s) => !(s.dayOfWeek === day && s.hour === hour)));
        },
        [slots, onChange, slotMap, isCellLocked, setDirtyCells],
    );
}

/** Drag-to-paint interaction handlers */
export function useDragPaint(
    slots: GameTimeSlot[], slotMap: Map<string, GameTimeSlot>,
    nextWeekSlotMap: Map<string, GameTimeSlot> | null,
    onChange: ((slots: GameTimeSlot[]) => void) | undefined,
    isInteractive: boolean, todayIndex?: number, currentHour?: number,
) {
    const dragging = useRef(false);
    const paintMode = useRef<'paint' | 'erase'>('paint');
    const [dirtyCells, setDirtyCells] = useState<ReadonlySet<string>>(() => new Set());
    const isPastCell = useIsPastCell(todayIndex, currentHour);
    const getSlotStatus = useSlotStatus(slotMap, nextWeekSlotMap, isPastCell, dirtyCells);
    const isCellLocked = useCellLocked(getSlotStatus);
    const toggleCell = useToggleCell(slots, slotMap, onChange, isCellLocked, setDirtyCells);
    const handlePointerDown = useCallback((day: number, hour: number) => {
        if (!isInteractive || isCellLocked(day, hour)) return;
        dragging.current = true;
        paintMode.current = slotMap.get(`${day}:${hour}`)?.status === 'available' ? 'erase' : 'paint';
        toggleCell(day, hour, paintMode.current);
    }, [isInteractive, toggleCell, isCellLocked, slotMap]);
    const handlePointerEnter = useCallback((day: number, hour: number) => {
        if (!dragging.current || !isInteractive) return;
        toggleCell(day, hour, paintMode.current);
    }, [isInteractive, toggleCell]);
    const handlePointerUp = useCallback(() => { dragging.current = false; }, []);
    return { isPastCell, getSlotStatus, isCellLocked, handlePointerDown, handlePointerEnter, handlePointerUp };
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
