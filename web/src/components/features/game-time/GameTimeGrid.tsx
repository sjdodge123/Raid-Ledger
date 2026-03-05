import { Fragment, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
import type { GameTimeGridProps } from './game-time-grid.types';
import {
    DAYS, FULL_DAYS, ALL_HOURS, CELL_GAP,
    formatHour, formatTooltip,
    getCellClasses, getVisualGroup, getMergeColor,
} from './game-time-grid.utils';
import {
    RollingWeekDivider, TodayHighlight, CurrentTimeIndicator,
    EventBlockOverlays, PreviewBlockOverlays,
} from './GridOverlays';

export type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
export type { GameTimePreviewBlock, HeatmapCell, GameTimeGridProps } from './game-time-grid.types';

/**
 * Reusable 7-day x 24-hour heatmap grid for game time (ROK-189).
 * Supports drag-to-paint for setting available slots.
 */
export function GameTimeGrid({
    slots, onChange, readOnly, className, tzLabel,
    events, onEventClick, previewBlocks, todayIndex, currentHour,
    hourRange, nextWeekEvents, nextWeekSlots, weekStart,
    heatmapOverlay, onCellClick, fullDayNames, compact, noStickyOffset,
}: GameTimeGridProps) {
    const [rangeStart, rangeEnd] = hourRange ?? [0, 24];
    const HOURS = useMemo(() => ALL_HOURS.filter((h) => h >= rangeStart && h < rangeEnd), [rangeStart, rangeEnd]);

    const slotMap = useMemo(() => {
        const map = new Map<string, GameTimeSlot>();
        for (const slot of slots) map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
        return map;
    }, [slots]);

    const nextWeekSlotMap = useMemo(() => {
        if (!nextWeekSlots) return null;
        const map = new Map<string, GameTimeSlot>();
        for (const slot of nextWeekSlots) map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
        return map;
    }, [nextWeekSlots]);

    const heatmapMap = useMemo(() => {
        if (!heatmapOverlay) return null;
        const map = new Map<string, { available: number; total: number }>();
        for (const cell of heatmapOverlay) {
            map.set(`${cell.dayOfWeek}:${cell.hour}`, { available: cell.availableCount, total: cell.totalCount });
        }
        return map;
    }, [heatmapOverlay]);

    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';
    const [hoveredCell, setHoveredCell] = useState<string | null>(null);
    const dragging = useRef(false);
    const paintMode = useRef<'paint' | 'erase'>('paint');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridDims, setGridDims] = useState<{ colWidth: number; rowHeight: number; headerHeight: number; colStartLeft: number } | null>(null);

    const eventCellSet = useMemo(() => {
        const set = new Set<string>();
        if (events) {
            for (const ev of events) {
                for (let h = ev.startHour; h < ev.endHour; h++) set.add(`${ev.dayOfWeek}:${h}`);
            }
        }
        return set;
    }, [events]);

    const isPastCell = useCallback(
        (dayIndex: number, hour: number): boolean => {
            if (todayIndex === undefined || currentHour === undefined) return false;
            return dayIndex < todayIndex || (dayIndex === todayIndex && hour < Math.floor(currentHour));
        },
        [todayIndex, currentHour],
    );

    const isInteractive = !readOnly && !!onChange;

    const [hoverDay, hoverHour] = useMemo(() => {
        if (!hoveredCell) return [-1, -1];
        const [d, h] = hoveredCell.split(':').map(Number);
        return [d, h];
    }, [hoveredCell]);

    const needsMeasurement = (events?.length ?? 0) > 0 || (previewBlocks?.length ?? 0) > 0 || todayIndex !== undefined || isInteractive;
    useEffect(() => {
        const el = gridRef.current;
        const wrapper = wrapperRef.current;
        if (!el || !wrapper || !needsMeasurement) return;
        const measure = () => {
            const firstCell = el.querySelector(`[data-testid="cell-0-${rangeStart}"]`) ?? el.querySelector(`[data-testid^="cell-0-"]`);
            if (!firstCell || !(firstCell instanceof HTMLElement)) return;
            const gridOffsetTop = el.offsetTop;
            const gridOffsetLeft = el.offsetLeft;
            const allCells = el.querySelectorAll('[data-testid^="cell-0-"]');
            let rowHeight = firstCell.offsetHeight + CELL_GAP;
            if (allCells.length >= 2) {
                const c0 = allCells[0] as HTMLElement;
                const c1 = allCells[1] as HTMLElement;
                rowHeight = c1.offsetTop - c0.offsetTop;
            }
            setGridDims({
                colWidth: firstCell.offsetWidth, rowHeight,
                headerHeight: gridOffsetTop + firstCell.offsetTop,
                colStartLeft: gridOffsetLeft + firstCell.offsetLeft,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [needsMeasurement, rangeStart, rangeEnd]);

    const [dirtyCells, setDirtyCells] = useState<ReadonlySet<string>>(() => new Set());

    const getSlotStatus = useCallback(
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

    const isCellLocked = useCallback(
        (day: number, hour: number): boolean => {
            const status = getSlotStatus(day, hour);
            return status === 'committed' || status === 'blocked';
        },
        [getSlotStatus],
    );

    const toggleCell = useCallback(
        (day: number, hour: number, mode: 'paint' | 'erase') => {
            if (!onChange || isCellLocked(day, hour)) return;
            const key = `${day}:${hour}`;
            setDirtyCells(prev => { const next = new Set(prev); next.add(key); return next; });
            const existing = slotMap.get(key);
            if (mode === 'paint' && !existing) {
                onChange([...slots, { dayOfWeek: day, hour, status: 'available' }]);
            } else if (mode === 'erase' && existing?.status === 'available') {
                onChange(slots.filter((s) => !(s.dayOfWeek === day && s.hour === hour)));
            }
        },
        [slots, onChange, slotMap, isCellLocked],
    );

    const handlePointerDown = useCallback(
        (day: number, hour: number) => {
            if (!isInteractive || isCellLocked(day, hour)) return;
            dragging.current = true;
            paintMode.current = slotMap.get(`${day}:${hour}`)?.status === 'available' ? 'erase' : 'paint';
            toggleCell(day, hour, paintMode.current);
        },
        [isInteractive, toggleCell, isCellLocked, slotMap],
    );

    const handlePointerEnter = useCallback(
        (day: number, hour: number) => {
            setHoveredCell(`${day}:${hour}`);
            if (!dragging.current || !isInteractive) return;
            toggleCell(day, hour, paintMode.current);
        },
        [isInteractive, toggleCell],
    );

    const handlePointerUp = useCallback(() => { dragging.current = false; }, []);

    const dayDates = useMemo(() => {
        if (!weekStart) return null;
        const dateStr = weekStart.split('T')[0];
        const [y, m, d] = dateStr.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        const base = new Date(y, m - 1, d);
        return DAYS.map((_, i) => { const dt = new Date(base); dt.setDate(base.getDate() + i); return `${dt.getMonth() + 1}/${dt.getDate()}`; });
    }, [weekStart]);

    const nextWeekDayDates = useMemo(() => {
        if (!weekStart) return null;
        const dateStr = weekStart.split('T')[0];
        const [y, m, d] = dateStr.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        const base = new Date(y, m - 1, d);
        base.setDate(base.getDate() + 7);
        return DAYS.map((_, i) => { const dt = new Date(base); dt.setDate(base.getDate() + i); return `${dt.getMonth() + 1}/${dt.getDate()}`; });
    }, [weekStart]);

    const getEventsForDisplay = useCallback((): GameTimeEventBlock[] => {
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
                if (ev.dayOfWeek < todayIndex) {
                    result.push(ev);
                } else if (ev.dayOfWeek === todayIndex && nowHour !== undefined && ev.endHour <= nowHour) {
                    result.push(ev);
                }
            }
        }
        return result;
    }, [events, nextWeekEvents, todayIndex, currentHour]);

    const displayEvents = useMemo(() => getEventsForDisplay(), [getEventsForDisplay]);

    const gridLineBackground = useMemo(() => {
        if (hoverDay < 0 || !gridDims || !isInteractive) return undefined;
        const x = gridDims.colStartLeft + hoverDay * (gridDims.colWidth + CELL_GAP) + gridDims.colWidth / 2;
        const y = gridDims.headerHeight + (hoverHour - rangeStart) * gridDims.rowHeight + gridDims.rowHeight / 2;
        return `radial-gradient(circle 100px at ${x}px ${y}px, var(--gt-hover-glow), transparent 80%)`;
    }, [hoverDay, hoverHour, gridDims, isInteractive, rangeStart]);

    return (
        <div ref={wrapperRef} className={`relative overflow-hidden ${className ?? ''}`}>
            {hoveredCell && (
                <div className="absolute z-30 px-2 py-1 bg-overlay text-foreground text-xs rounded whitespace-nowrap pointer-events-none" style={{ top: 0, right: 0 }}>
                    {(() => {
                        const [d, h] = hoveredCell.split(':').map(Number);
                        const past = isPastCell(d, h);
                        const dateLabel = past && nextWeekDayDates ? nextWeekDayDates[d] : dayDates?.[d];
                        const hm = heatmapMap?.get(`${d}:${h}`);
                        if (hm) return `${hm.available} of ${hm.total} players available`;
                        return formatTooltip(d, h, getSlotStatus(d, h), dateLabel ?? undefined);
                    })()}
                </div>
            )}

            <div
                ref={gridRef}
                className="grid gap-px select-none"
                style={{ gridTemplateColumns: '48px repeat(7, 1fr)', touchAction: 'none', background: gridLineBackground }}
                onPointerUp={handlePointerUp}
                onPointerLeave={() => { handlePointerUp(); setHoveredCell(null); }}
                data-testid="game-time-grid"
            >
                <div
                    className={`sticky ${noStickyOffset ? 'top-0' : isHeaderHidden ? 'top-0' : 'top-16'} z-10 bg-surface flex items-center justify-center`}
                    style={{ transition: noStickyOffset ? undefined : 'top 300ms ease-in-out' }}
                >
                    {tzLabel && <span className="text-[10px] text-dim font-medium">{tzLabel}</span>}
                </div>
                {DAYS.map((day, i) => (
                    <DayHeader
                        key={day}
                        dayIndex={i}
                        fullDayNames={fullDayNames}
                        todayIndex={todayIndex}
                        hasRolling={!!nextWeekSlots}
                        dateLabel={dayDates?.[i]}
                        nextDateLabel={nextWeekDayDates?.[i]}
                        noStickyOffset={noStickyOffset}
                        isHeaderHidden={isHeaderHidden}
                    />
                ))}

                {HOURS.map((hour) => (
                    <Fragment key={`row-${hour}`}>
                        <div className="text-right text-xs text-dim pr-2 py-0.5 flex items-center justify-end">
                            {formatHour(hour)}
                        </div>
                        {DAYS.map((_, dayIndex) => (
                            <GridCell
                                key={`${dayIndex}-${hour}`}
                                dayIndex={dayIndex}
                                hour={hour}
                                rangeStart={rangeStart}
                                rangeEnd={rangeEnd}
                                compact={compact}
                                getSlotStatus={getSlotStatus}
                                isCellLocked={isCellLocked}
                                isPastCell={isPastCell}
                                eventCellSet={eventCellSet}
                                heatmapMap={heatmapMap}
                                hoveredCell={hoveredCell}
                                hoverDay={hoverDay}
                                hoverHour={hoverHour}
                                isInteractive={isInteractive}
                                nextWeekSlotMap={nextWeekSlotMap}
                                onCellClick={onCellClick}
                                onPointerDown={handlePointerDown}
                                onPointerEnter={handlePointerEnter}
                            />
                        ))}
                    </Fragment>
                ))}
            </div>

            {todayIndex !== undefined && nextWeekSlots && gridDims && currentHour !== undefined && (
                <RollingWeekDivider
                    todayIndex={todayIndex} gridDims={gridDims}
                    currentHour={currentHour} hoursCount={HOURS.length} rangeStart={rangeStart}
                />
            )}
            {todayIndex !== undefined && gridDims && (
                <TodayHighlight
                    todayIndex={todayIndex} gridDims={gridDims}
                    hoursCount={HOURS.length} hasRolling={!!nextWeekSlots}
                    currentHour={currentHour} rangeStart={rangeStart}
                />
            )}
            {todayIndex !== undefined && currentHour !== undefined && gridDims && (
                <CurrentTimeIndicator
                    todayIndex={todayIndex} currentHour={currentHour}
                    gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd}
                />
            )}
            {displayEvents.length > 0 && gridDims && (
                <EventBlockOverlays
                    displayEvents={displayEvents} gridDims={gridDims}
                    rangeStart={rangeStart} rangeEnd={rangeEnd} onEventClick={onEventClick}
                />
            )}
            {previewBlocks && previewBlocks.length > 0 && gridDims && (
                <PreviewBlockOverlays
                    previewBlocks={previewBlocks} displayEvents={displayEvents}
                    gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd}
                />
            )}
        </div>
    );
}

function DayHeader({
    dayIndex, fullDayNames, todayIndex, hasRolling,
    dateLabel, nextDateLabel, noStickyOffset, isHeaderHidden,
}: {
    dayIndex: number; fullDayNames?: boolean; todayIndex?: number;
    hasRolling: boolean; dateLabel?: string; nextDateLabel?: string;
    noStickyOffset?: boolean; isHeaderHidden: boolean;
}) {
    const displayDay = fullDayNames ? FULL_DAYS[dayIndex] : DAYS[dayIndex];
    const isToday = todayIndex === dayIndex;
    const isTodaySplit = isToday && hasRolling;
    const isRollingPast = todayIndex !== undefined && hasRolling && dayIndex < todayIndex;

    return (
        <div
            className={`sticky ${noStickyOffset ? 'top-0' : isHeaderHidden ? 'top-0' : 'top-16'} z-10 text-center text-xs font-medium py-1 ${isTodaySplit ? 'text-secondary' : isToday ? 'bg-emerald-500/15 text-emerald-300' : isRollingPast ? 'bg-panel/80 text-dim' : 'bg-surface text-muted'}`}
            style={{
                transition: 'top 300ms ease-in-out',
                ...(isTodaySplit ? { background: 'linear-gradient(to right, var(--gt-split-bg) 50%, rgba(16, 185, 129, 0.15) 50%)' } : {}),
            }}
            data-testid={`day-header-${dayIndex}`}
        >
            {isRollingPast && nextDateLabel ? (
                <span className="flex flex-col items-center leading-none gap-0.5">
                    <span>{displayDay}</span>
                    <span className="text-[9px] opacity-60 leading-none">{nextDateLabel}</span>
                </span>
            ) : isTodaySplit && dateLabel && nextDateLabel ? (
                <span className="flex flex-col items-center leading-none gap-0.5">
                    <span>{displayDay}</span>
                    <span className="text-[9px] leading-none flex items-center gap-0.5">
                        <span className="text-muted">{nextDateLabel}</span>
                        <span className="text-dim">/</span>
                        <span className="text-emerald-400/80">{dateLabel}</span>
                    </span>
                </span>
            ) : dateLabel ? (
                <span className="flex flex-col items-center leading-none gap-0.5">
                    <span>{displayDay}</span>
                    <span className="text-[9px] opacity-60 leading-none">{dateLabel}</span>
                </span>
            ) : (
                displayDay
            )}
        </div>
    );
}

function GridCell({
    dayIndex, hour, rangeStart, rangeEnd, compact,
    getSlotStatus, isCellLocked, isPastCell, eventCellSet,
    heatmapMap, hoveredCell, hoverDay, hoverHour,
    isInteractive, nextWeekSlotMap, onCellClick,
    onPointerDown, onPointerEnter,
}: {
    dayIndex: number; hour: number; rangeStart: number; rangeEnd: number; compact?: boolean;
    getSlotStatus: (d: number, h: number) => string | undefined;
    isCellLocked: (d: number, h: number) => boolean;
    isPastCell: (d: number, h: number) => boolean;
    eventCellSet: Set<string>;
    heatmapMap: Map<string, { available: number; total: number }> | null;
    hoveredCell: string | null; hoverDay: number; hoverHour: number;
    isInteractive: boolean;
    nextWeekSlotMap: Map<string, import('@raid-ledger/contract').GameTimeSlot> | null;
    onCellClick?: (d: number, h: number) => void;
    onPointerDown: (d: number, h: number) => void;
    onPointerEnter: (d: number, h: number) => void;
}) {
    const status = getSlotStatus(dayIndex, hour);
    const locked = isCellLocked(dayIndex, hour);
    const hasOverlay = eventCellSet.has(`${dayIndex}:${hour}`);
    const cellClasses = getCellClasses(status, hasOverlay);
    const past = isPastCell(dayIndex, hour);

    const group = getVisualGroup(status, hasOverlay);
    const prevHour = hour - 1;
    const nextHour = hour + 1;
    const aboveGroup = prevHour >= rangeStart ? getVisualGroup(getSlotStatus(dayIndex, prevHour), eventCellSet.has(`${dayIndex}:${prevHour}`)) : null;
    const belowGroup = nextHour < rangeEnd ? getVisualGroup(getSlotStatus(dayIndex, nextHour), eventCellSet.has(`${dayIndex}:${nextHour}`)) : null;
    const sameAbove = aboveGroup === group;
    const sameBelow = belowGroup === group;
    const rounding = sameAbove && sameBelow ? '' : sameAbove ? 'rounded-b-sm' : sameBelow ? 'rounded-t-sm' : 'rounded-sm';

    const heatmapData = heatmapMap?.get(`${dayIndex}:${hour}`);
    const heatmapIntensity = heatmapData ? heatmapData.available / heatmapData.total : 0;
    const isHovered = hoveredCell === `${dayIndex}:${hour}`;
    const canInteract = isInteractive && !locked;
    const clickable = !!onCellClick;
    const isErase = status === 'available';
    const dist = hoverDay >= 0 ? Math.max(Math.abs(dayIndex - hoverDay), Math.abs(hour - hoverHour)) : Infinity;

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

    const heatmapBg = heatmapData
        ? heatmapIntensity >= 1.0
            ? `rgba(34, 197, 94, ${(0.3 + heatmapIntensity * 0.35).toFixed(2)})`
            : heatmapIntensity > 0.5
                ? `rgba(234, 179, 8, ${(0.25 + heatmapIntensity * 0.35).toFixed(2)})`
                : `rgba(239, 68, 68, ${(0.2 + heatmapIntensity * 0.35).toFixed(2)})`
        : undefined;

    const cellStyle: React.CSSProperties = {
        ...(shadows.length ? { boxShadow: shadows.join(', ') } : {}),
        ...(heatmapBg ? { backgroundColor: heatmapBg } : {}),
    };

    return (
        <div
            className={`${compact ? 'h-4' : 'h-5'} ${rounding} transition-colors ${heatmapBg ? '' : cellClasses} ${canInteract || clickable ? 'cursor-pointer' : locked ? 'cursor-not-allowed' : ''} ${past && nextWeekSlotMap && !isHovered ? 'opacity-60' : ''} ${isHovered && (isInteractive || clickable) ? 'z-10 relative' : ''}`}
            style={Object.keys(cellStyle).length ? cellStyle : undefined}
            data-testid={`cell-${dayIndex}-${hour}`}
            data-status={status ?? 'inactive'}
            title={heatmapData ? `${heatmapData.available} of ${heatmapData.total} players available` : undefined}
            onPointerDown={() => onPointerDown(dayIndex, hour)}
            onPointerEnter={() => onPointerEnter(dayIndex, hour)}
            onClick={clickable ? () => onCellClick!(dayIndex, hour) : undefined}
        />
    );
}
