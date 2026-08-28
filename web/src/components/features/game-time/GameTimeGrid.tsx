import type { JSX } from 'react';
import { useRef, useState, useMemo, useCallback } from 'react';
import type { GameTimeGridProps } from './game-time-grid.types';
import { formatTooltip } from './game-time-grid.utils';
import { toggleAllDaySlots, isAllDayActive } from './game-time-slot.utils';
import { GridBody } from './GridBody';
import { GridOverlayLayer } from './GridOverlayLayer';
import { useSlotMaps, useWeekDates, useDisplayEvents, useGridMeasurement, useSlotView, useHoverGlow, useVisibleHours, useScrollDirection } from './use-game-time-grid';
import { deriveAllBlocks } from './slot-blocks.utils';
import { useBlockEditor } from './use-block-editor';
import { SlotBlockLayer } from './SlotBlockLayer';
import { SelectedBlockInspector } from './SelectedBlockInspector';

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
    const handleDayClick = useCallback((dayIndex: number): void => { if (isInteractive && onChange) onChange(toggleAllDaySlots(slots, dayIndex, hourRange)); }, [isInteractive, onChange, slots, hourRange]);
    const isDayAllActive = useCallback((dayIndex: number): boolean => isAllDayActive(slots, dayIndex, hourRange), [slots, hourRange]);
    return { vis, maps, dates, displayEvents, isHeaderHidden, isInteractive, handleDayClick, isDayAllActive };
}

/**
 * Availability blocks for the interactive editor, plus a cell-status view that
 * hides `available` so the block layer owns that fill and the two never
 * double-render. Read-only grids are untouched: no blocks, no layer, and cell
 * hover keeps working for the heatmap tooltip.
 */
function useBlockEditing(
    slots: GameTimeGridProps['slots'], onChange: GameTimeGridProps['onChange'],
    hours: number[], isInteractive: boolean, rowHeight: number | undefined,
    getSlotStatus: (d: number, h: number) => string | undefined,
) {
    const blocks = useMemo(
        () => (isInteractive ? deriveAllBlocks(slots, hours) : []),
        [isInteractive, slots, hours],
    );
    const editor = useBlockEditor(slots, onChange, hours, rowHeight);
    const cellStatus = useCallback(
        (d: number, h: number) => {
            const status = getSlotStatus(d, h);
            return isInteractive && status === 'available' ? undefined : status;
        },
        [getSlotStatus, isInteractive],
    );
    return { blocks, editor, cellStatus };
}

/**
 * Reusable 7-day x 24-hour heatmap grid for game time (ROK-189).
 * Interactive grids edit availability as blocks with drag handles (ROK-1426).
 */
export function GameTimeGrid(props: GameTimeGridProps): JSX.Element {
    const { slots, onChange, className, tzLabel, onEventClick, previewBlocks, todayIndex, currentHour, nextWeekSlots, onCellClick, fullDayNames, compact, noStickyOffset } = props;
    const { vis, maps, dates, displayEvents, isHeaderHidden, isInteractive, handleDayClick, isDayAllActive } = useGridHooks(props);
    const [hoveredCell, setHoveredCell] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const needsMeasure = (props.events?.length ?? 0) > 0 || (previewBlocks?.length ?? 0) > 0 || todayIndex !== undefined || isInteractive;
    const gridDims = useGridMeasurement(gridRef, wrapperRef, needsMeasure, vis.rangeStart, vis.rangeEnd);
    const view = useSlotView(maps.slotMap, maps.nextWeekSlotMap, todayIndex, currentHour);
    const { blocks, editor, cellStatus } = useBlockEditing(slots, onChange, vis.HOURS, isInteractive, gridDims?.rowHeight, view.getSlotStatus);
    const [hoverDay, hoverHour] = useMemo(() => hoveredCell ? hoveredCell.split(':').map(Number) as [number, number] : [-1, -1], [hoveredCell]);
    const glowBg = useHoverGlow(hoverDay, hoverHour, gridDims, isInteractive, vis.rangeStart);

    return (
        <>
            <div
                ref={wrapperRef}
                className={`relative overflow-hidden ${className ?? ''}`}
                onPointerLeave={() => setHoveredCell(null)}
            >
                <HoverTooltip hoveredCell={hoveredCell} isPastCell={view.isPastCell} nextWeekDayDates={dates.nextWeekDayDates} dayDates={dates.dayDates} heatmapMap={maps.heatmapMap} getSlotStatus={view.getSlotStatus} />
                <GridBody
                    gridRef={gridRef} gridLineBackground={glowBg} setHoveredCell={setHoveredCell}
                    tzLabel={tzLabel} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden}
                    dayDates={dates.dayDates} nextWeekDayDates={dates.nextWeekDayDates} fullDayNames={fullDayNames} todayIndex={todayIndex} nextWeekSlots={nextWeekSlots}
                    HOURS={vis.HOURS} rangeStart={vis.rangeStart} rangeEnd={vis.rangeEnd} compact={compact}
                    getSlotStatus={cellStatus} isCellLocked={view.isCellLocked} isPastCell={view.isPastCell}
                    eventCellSet={maps.eventCellSet} heatmapMap={maps.heatmapMap} hoveredCell={hoveredCell} hoverDay={hoverDay} hoverHour={hoverHour}
                    isInteractive={isInteractive} nextWeekSlotMap={maps.nextWeekSlotMap} onCellClick={onCellClick}
                    onPointerEnter={(d, h) => setHoveredCell(`${d}:${h}`)}
                    onDayClick={isInteractive ? handleDayClick : undefined}
                    isDayAllActive={isInteractive ? isDayAllActive : undefined}
                />
                <GridOverlayLayer todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} nextWeekSlots={nextWeekSlots} HOURS={vis.HOURS} rangeStart={vis.rangeStart} rangeEnd={vis.rangeEnd} displayEvents={displayEvents} onEventClick={onEventClick} previewBlocks={previewBlocks} />
                {isInteractive && gridDims && (
                    <SlotBlockLayer
                        blocks={blocks} editor={editor} gridDims={gridDims} hours={vis.HOURS}
                        onHoverCell={(d, h) => setHoveredCell(`${d}:${h}`)}
                    />
                )}
            </div>
            {isInteractive && editor.selection && (
                <SelectedBlockInspector
                    selection={editor.selection} slots={slots} hours={vis.HOURS}
                    onAdjust={editor.adjust} onRemove={editor.removeSelected} onDone={editor.clearSelection}
                />
            )}
        </>
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
        <div
            className="absolute z-30 px-2 py-1 bg-overlay text-foreground text-xs rounded whitespace-nowrap pointer-events-none"
            style={{ top: 0, right: 0 }}
            data-testid="game-time-hover-tooltip"
        >
            {text}
        </div>
    );
}
