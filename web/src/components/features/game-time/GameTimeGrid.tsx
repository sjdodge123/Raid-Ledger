import type { JSX } from 'react';
import { useRef, useState, useMemo, useCallback } from 'react';
import type { GameTimeGridProps } from './game-time-grid.types';
import { formatTooltip } from './game-time-grid.utils';
import { toggleAllDaySlots, isAllDayActive } from './game-time-slot.utils';
import { GridBody } from './GridBody';
import { GridOverlayLayer } from './GridOverlayLayer';
import { useSlotMaps, useWeekDates, useDisplayEvents, useGridMeasurement, useDragPaint, useHoverGlow, useVisibleHours, useScrollDirection } from './use-game-time-grid';

export type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
export type { GameTimePreviewBlock, HeatmapCell, GameTimeGridProps } from './game-time-grid.types';

/** All non-ref state needed by the grid, bundled for function-size compliance */
function useGridHooks(props: GameTimeGridProps) {
    const { slots, onChange, readOnly, events, todayIndex, currentHour, hourRange, nextWeekEvents, nextWeekSlots, weekStart, heatmapOverlay } = props;
    const vis = useVisibleHours(hourRange);
    const maps = useSlotMaps(slots, nextWeekSlots, heatmapOverlay, events);
    const dates = useWeekDates(weekStart);
    const displayEvents = useDisplayEvents(events, nextWeekEvents, todayIndex, currentHour);
    const isHeaderHidden = useScrollDirection() === 'down';
    const isInteractive = !readOnly && !!onChange;
    const handleDayClick = useCallback((dayIndex: number): void => { if (isInteractive && onChange) onChange(toggleAllDaySlots(slots, dayIndex)); }, [isInteractive, onChange, slots]);
    const isDayAllActive = useCallback((dayIndex: number): boolean => isAllDayActive(slots, dayIndex), [slots]);
    return { vis, maps, dates, displayEvents, isHeaderHidden, isInteractive, handleDayClick, isDayAllActive };
}

/**
 * Reusable 7-day x 24-hour heatmap grid for game time (ROK-189).
 * Supports drag-to-paint for setting available slots.
 */
export function GameTimeGrid(props: GameTimeGridProps): JSX.Element {
    const { slots, onChange, className, tzLabel, onEventClick, previewBlocks, todayIndex, currentHour, nextWeekSlots, onCellClick, fullDayNames, compact, noStickyOffset } = props;
    const { vis, maps, dates, displayEvents, isHeaderHidden, isInteractive, handleDayClick, isDayAllActive } = useGridHooks(props);
    const [hoveredCell, setHoveredCell] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const needsMeasure = (props.events?.length ?? 0) > 0 || (previewBlocks?.length ?? 0) > 0 || todayIndex !== undefined || isInteractive;
    const gridDims = useGridMeasurement(gridRef, wrapperRef, needsMeasure, vis.rangeStart, vis.rangeEnd);
    const drag = useDragPaint(slots, maps.slotMap, maps.nextWeekSlotMap, onChange, isInteractive, todayIndex, currentHour);
    const onEnter = (day: number, hour: number): void => { setHoveredCell(`${day}:${hour}`); drag.handlePointerEnter(day, hour); };
    const [hoverDay, hoverHour] = useMemo(() => hoveredCell ? hoveredCell.split(':').map(Number) as [number, number] : [-1, -1], [hoveredCell]);
    const glowBg = useHoverGlow(hoverDay, hoverHour, gridDims, isInteractive, vis.rangeStart);

    return (
        <div ref={wrapperRef} className={`relative overflow-hidden ${className ?? ''}`}>
            <HoverTooltip hoveredCell={hoveredCell} isPastCell={drag.isPastCell} nextWeekDayDates={dates.nextWeekDayDates} dayDates={dates.dayDates} heatmapMap={maps.heatmapMap} getSlotStatus={drag.getSlotStatus} />
            <GridBody
                gridRef={gridRef} gridLineBackground={glowBg} handlePointerUp={drag.handlePointerUp} setHoveredCell={setHoveredCell}
                tzLabel={tzLabel} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden}
                dayDates={dates.dayDates} nextWeekDayDates={dates.nextWeekDayDates} fullDayNames={fullDayNames} todayIndex={todayIndex} nextWeekSlots={nextWeekSlots}
                HOURS={vis.HOURS} rangeStart={vis.rangeStart} rangeEnd={vis.rangeEnd} compact={compact}
                getSlotStatus={drag.getSlotStatus} isCellLocked={drag.isCellLocked} isPastCell={drag.isPastCell}
                eventCellSet={maps.eventCellSet} heatmapMap={maps.heatmapMap} hoveredCell={hoveredCell} hoverDay={hoverDay} hoverHour={hoverHour}
                isInteractive={isInteractive} nextWeekSlotMap={maps.nextWeekSlotMap} onCellClick={onCellClick} onPointerDown={drag.handlePointerDown} onPointerEnter={onEnter}
                onDayClick={isInteractive ? handleDayClick : undefined}
                isDayAllActive={isInteractive ? isDayAllActive : undefined}
            />
            <GridOverlayLayer todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} nextWeekSlots={nextWeekSlots} HOURS={vis.HOURS} rangeStart={vis.rangeStart} rangeEnd={vis.rangeEnd} displayEvents={displayEvents} onEventClick={onEventClick} previewBlocks={previewBlocks} />
        </div>
    );
}

/** Floating tooltip showing cell info on hover */
function HoverTooltip({ hoveredCell, isPastCell, nextWeekDayDates, dayDates, heatmapMap, getSlotStatus }: {
    hoveredCell: string | null; isPastCell: (d: number, h: number) => boolean;
    nextWeekDayDates: string[] | null; dayDates: string[] | null;
    heatmapMap: Map<string, { available: number; total: number }> | null;
    getSlotStatus: (d: number, h: number) => string | undefined;
}): JSX.Element | null {
    if (!hoveredCell) return null;
    const [d, h] = hoveredCell.split(':').map(Number);
    const past = isPastCell(d, h);
    const dateLabel = past && nextWeekDayDates ? nextWeekDayDates[d] : dayDates?.[d];
    const hm = heatmapMap?.get(`${d}:${h}`);
    const text = hm ? `${hm.available} of ${hm.total} players available` : formatTooltip(d, h, getSlotStatus(d, h), dateLabel ?? undefined);

    return (
        <div className="absolute z-30 px-2 py-1 bg-overlay text-foreground text-xs rounded whitespace-nowrap pointer-events-none" style={{ top: 0, right: 0 }}>
            {text}
        </div>
    );
}
