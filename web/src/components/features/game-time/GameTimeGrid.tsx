import { Fragment, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { getGameTimeBlockStyle, getGameColors } from '../../../constants/game-colors';
import { AttendeeAvatars } from '../../calendar/AttendeeAvatars';

export type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';

/** Preview block for showing where a specific event falls on the grid */
export interface GameTimePreviewBlock {
    dayOfWeek: number; // 0=Sun, 6=Sat
    startHour: number;
    endHour: number;
    label?: string;
    /** 'current' = dashed amber (default), 'selected' = solid emerald (ROK-223) */
    variant?: 'current' | 'selected';
    // Rich fields (optional, for calendar-parity rendering inside the block)
    title?: string;
    gameName?: string;
    gameSlug?: string;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string | null;
    attendees?: Array<{ id: number; username: string; avatar: string | null }>;
    attendeeCount?: number;
}

/** Single cell in a heatmap overlay (ROK-223) */
export interface HeatmapCell {
    dayOfWeek: number;
    hour: number;
    availableCount: number;
    totalCount: number;
}

export interface GameTimeGridProps {
    slots: GameTimeSlot[];
    onChange?: (slots: GameTimeSlot[]) => void;
    readOnly?: boolean;
    className?: string;
    tzLabel?: string;
    events?: GameTimeEventBlock[];
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
    previewBlocks?: GameTimePreviewBlock[];
    /** Day index for today (0=Sun, 6=Sat) — highlights the column green */
    todayIndex?: number;
    /** Fractional current hour (e.g., 15.5 = 3:30 PM) — red time indicator line */
    currentHour?: number;
    /** Visible hour range (default [0, 24]) — use [6, 24] in modals */
    hourRange?: [number, number];
    /** Events for the next week (shown in "past" cells for rolling view) */
    nextWeekEvents?: GameTimeEventBlock[];
    /** Slots for the next week (shown in "past" cells for rolling view) */
    nextWeekSlots?: GameTimeSlot[];
    /** ISO date string for the start of the displayed week (e.g., "2026-02-08") */
    weekStart?: string;
    /** Heatmap overlay data: intensity cells for aggregate availability (ROK-223) */
    heatmapOverlay?: HeatmapCell[];
    /** Callback when a cell is clicked (ROK-223, used in reschedule modal) */
    onCellClick?: (dayOfWeek: number, hour: number) => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function formatTooltip(dayIndex: number, hour: number, status?: string, dateLabel?: string): string {
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayIndex];
    const startStr = formatHour(hour);
    const endStr = formatHour((hour + 1) % 24);
    const statusLabel = status && status !== 'available' ? ` — ${status.charAt(0).toUpperCase() + status.slice(1)}` : '';
    const datePart = dateLabel ? ` ${dateLabel}` : '';
    return `${dayName}${datePart} ${startStr} – ${endStr}${statusLabel}`;
}

function getCellClasses(status?: string, hasEventOverlay?: boolean): string {
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
function getVisualGroup(status?: string, hasEventOverlay?: boolean): string {
    if (!status) return 'inactive';
    if (status === 'committed' && hasEventOverlay) return 'committed-overlay';
    return status;
}

/** Box-shadow color used to fill the 1px grid gap between merged cells */
function getMergeColor(group: string): string {
    switch (group) {
        case 'available': return 'rgba(16, 185, 129, 0.7)';
        case 'committed': return 'rgba(59, 130, 246, 0.7)';
        case 'committed-overlay': return 'rgba(51, 65, 85, 0.3)';
        case 'blocked': return 'rgba(239, 68, 68, 0.5)';
        case 'freed': return 'rgba(16, 185, 129, 0.4)';
        default: return 'var(--gt-split-bg)';
    }
}

/** Duration badge (dark pill with hour count) */
function DurationBadge({ hours }: { hours: number }) {
    return (
        <span className="inline-flex items-center px-1 py-px rounded text-[8px] font-bold text-foreground/90 bg-black/40 leading-none">
            {hours}h
        </span>
    );
}

/** Rich event block content — adaptive tiers based on span */
function RichEventBlock({
    event,
    spanHours,
}: {
    event: {
        title: string;
        gameName?: string | null;
        gameSlug?: string | null;
        coverUrl?: string | null;
        startHour: number;
        endHour: number;
        description?: string | null;
        creatorUsername?: string | null;
        gameRegistryId?: string | null;
        signupsPreview?: Array<{ id: number; username: string; avatar: string | null; characters?: Array<{ gameId: string; avatarUrl: string | null }> }>;
        signupCount?: number;
    };
    spanHours: number;
}) {
    const colors = getGameColors(event.gameSlug ?? undefined);

    if (spanHours >= 3) {
        // Full rendering: duration badge, title, game, creator, description, avatars
        return (
            <div className="px-1.5 py-1 h-full flex flex-col gap-0.5 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                    <DurationBadge hours={spanHours} />
                    <span className="text-[10px] font-semibold leading-tight truncate text-foreground">
                        {event.title}
                    </span>
                </div>
                {event.gameName && (
                    <span className="text-[9px] text-foreground/60 leading-tight truncate">
                        {event.gameName}
                    </span>
                )}
                {event.creatorUsername && spanHours >= 4 && (
                    <span className="text-[8px] text-foreground/40 leading-tight truncate">
                        by {event.creatorUsername}
                    </span>
                )}
                {event.description && spanHours >= 5 && (
                    <span className="text-[8px] text-foreground/40 leading-tight line-clamp-2">
                        {event.description}
                    </span>
                )}
                {event.signupsPreview && event.signupsPreview.length > 0 && (
                    <div className="mt-auto">
                        <AttendeeAvatars
                            signups={event.signupsPreview}
                            totalCount={event.signupCount ?? event.signupsPreview.length}
                            maxVisible={3}
                            size="xs"
                            accentColor={colors.border}
                            gameId={event.gameRegistryId ?? undefined}
                        />
                    </div>
                )}
            </div>
        );
    }

    if (spanHours === 2) {
        // Medium: duration badge, title, game
        return (
            <div className="px-1 py-0.5 h-full flex flex-col gap-0.5 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                    <DurationBadge hours={spanHours} />
                    <span className="text-[10px] font-semibold leading-tight truncate text-foreground">
                        {event.title}
                    </span>
                </div>
                {event.gameName && (
                    <span className="text-[9px] text-foreground/60 leading-tight truncate">
                        {event.gameName}
                    </span>
                )}
            </div>
        );
    }

    // 1 hour: title only
    return (
        <div className="px-1 py-0.5 h-full flex items-center min-w-0 overflow-hidden">
            <span className="text-[10px] font-medium leading-tight truncate text-foreground">
                {event.title}
            </span>
        </div>
    );
}

/**
 * Reusable 7-day x 24-hour heatmap grid for game time (ROK-189).
 * Supports drag-to-paint for setting available slots.
 * Committed/blocked cells are read-only (not paintable).
 * Sunday-first day order aligned with calendar view.
 */
export function GameTimeGrid({
    slots,
    onChange,
    readOnly,
    className,
    tzLabel,
    events,
    onEventClick,
    previewBlocks,
    todayIndex,
    currentHour,
    hourRange,
    nextWeekEvents,
    nextWeekSlots,
    weekStart,
    heatmapOverlay,
    onCellClick,
}: GameTimeGridProps) {
    const [rangeStart, rangeEnd] = hourRange ?? [0, 24];
    const HOURS = useMemo(() => ALL_HOURS.filter((h) => h >= rangeStart && h < rangeEnd), [rangeStart, rangeEnd]);

    const slotMap = useMemo(() => {
        const map = new Map<string, GameTimeSlot>();
        for (const slot of slots) {
            map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
        }
        return map;
    }, [slots]);

    // Build next-week slot map for rolling view
    const nextWeekSlotMap = useMemo(() => {
        if (!nextWeekSlots) return null;
        const map = new Map<string, GameTimeSlot>();
        for (const slot of nextWeekSlots) {
            map.set(`${slot.dayOfWeek}:${slot.hour}`, slot);
        }
        return map;
    }, [nextWeekSlots]);

    // Build heatmap intensity map for aggregate availability (ROK-223)
    const heatmapMap = useMemo(() => {
        if (!heatmapOverlay) return null;
        const map = new Map<string, { available: number; total: number }>();
        for (const cell of heatmapOverlay) {
            map.set(`${cell.dayOfWeek}:${cell.hour}`, {
                available: cell.availableCount,
                total: cell.totalCount,
            });
        }
        return map;
    }, [heatmapOverlay]);

    const [hoveredCell, setHoveredCell] = useState<string | null>(null);
    const dragging = useRef(false);
    const paintMode = useRef<'paint' | 'erase'>('paint');
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridDims, setGridDims] = useState<{ colWidth: number; rowHeight: number; headerHeight: number; colStartLeft: number } | null>(null);

    // Build a set of cells that have event overlays for dimming committed cells
    const eventCellSet = useMemo(() => {
        const set = new Set<string>();
        if (events) {
            for (const ev of events) {
                for (let h = ev.startHour; h < ev.endHour; h++) {
                    set.add(`${ev.dayOfWeek}:${h}`);
                }
            }
        }
        return set;
    }, [events]);

    // Helper: is a cell in the "past" zone (for rolling week)?
    const isPastCell = useCallback(
        (dayIndex: number, hour: number): boolean => {
            if (todayIndex === undefined || currentHour === undefined) return false;
            return dayIndex < todayIndex || (dayIndex === todayIndex && hour < Math.floor(currentHour));
        },
        [todayIndex, currentHour],
    );

    const isInteractive = !readOnly && !!onChange;

    // Parse hovered cell for proximity effects (grid-line glow)
    const [hoverDay, hoverHour] = useMemo(() => {
        if (!hoveredCell) return [-1, -1];
        const [d, h] = hoveredCell.split(':').map(Number);
        return [d, h];
    }, [hoveredCell]);

    // Measure grid dimensions for absolute positioning of overlays + hover effects
    const needsMeasurement = (events?.length ?? 0) > 0 || (previewBlocks?.length ?? 0) > 0 || todayIndex !== undefined || isInteractive;
    useEffect(() => {
        const el = gridRef.current;
        if (!el || !needsMeasurement) return;

        const measure = () => {
            const firstCell = el.querySelector('[data-testid="cell-0-0"]') ??
                el.querySelector(`[data-testid^="cell-0-"]`);
            const dayHeader = el.querySelector('[data-testid="day-header-0"]');
            if (!firstCell || !dayHeader) return;

            const firstRect = firstCell.getBoundingClientRect();
            const gridRect = el.getBoundingClientRect();
            const headerRect = dayHeader.getBoundingClientRect();

            // Find the actual first two visible hour cells to measure row height
            const allCells = el.querySelectorAll('[data-testid^="cell-0-"]');
            let rowHeight = 20; // fallback
            if (allCells.length >= 2) {
                const r1 = allCells[0].getBoundingClientRect();
                const r2 = allCells[1].getBoundingClientRect();
                rowHeight = r2.top - r1.top;
            }

            setGridDims({
                colWidth: firstRect.width,
                rowHeight,
                headerHeight: headerRect.bottom - gridRect.top,
                colStartLeft: firstRect.left - gridRect.left,
            });
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [needsMeasurement, rangeStart, rangeEnd]);

    // Track cells the user has painted this session for correct rolling-week display.
    // Past cells show nextWeekSlotMap by default; only locally-painted cells use slotMap.
    const [dirtyCells, setDirtyCells] = useState<ReadonlySet<string>>(() => new Set());

    const getSlotStatus = useCallback(
        (day: number, hour: number): string | undefined => {
            const key = `${day}:${hour}`;
            // In rolling mode, past cells show next-week data unless locally painted
            if (nextWeekSlotMap && isPastCell(day, hour)) {
                if (dirtyCells.has(key)) {
                    return slotMap.get(key)?.status;
                }
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
            const existing = slotMap.get(`${day}:${hour}`);
            paintMode.current = existing?.status === 'available' ? 'erase' : 'paint';
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

    const handlePointerUp = useCallback(() => {
        dragging.current = false;
    }, []);

    // Gap between grid cells (gap-px = 1px)
    const gap = 1;

    // Compute date labels for day headers
    // weekStart may be ISO datetime ("2026-02-08T00:00:00.000Z") or date-only ("2026-02-08")
    const dayDates = useMemo(() => {
        if (!weekStart) return null;
        const dateStr = weekStart.split('T')[0]; // extract date portion
        const [y, m, d] = dateStr.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        const base = new Date(y, m - 1, d); // local date, no timezone shift
        return DAYS.map((_, i) => {
            const dt = new Date(base);
            dt.setDate(base.getDate() + i);
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });
    }, [weekStart]);

    const nextWeekDayDates = useMemo(() => {
        if (!weekStart) return null;
        const dateStr = weekStart.split('T')[0];
        const [y, m, d] = dateStr.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
        const base = new Date(y, m - 1, d);
        base.setDate(base.getDate() + 7);
        return DAYS.map((_, i) => {
            const dt = new Date(base);
            dt.setDate(base.getDate() + i);
            return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });
    }, [weekStart]);

    // Determine which events to show based on rolling view
    const getEventsForDisplay = useCallback((): GameTimeEventBlock[] => {
        if (!events) return [];
        if (!nextWeekEvents) return events;

        const nowHour = currentHour !== undefined ? Math.floor(currentHour) : undefined;

        // Merge: for "past" day/hour slots, show next week events; otherwise current week
        const result: GameTimeEventBlock[] = [];

        for (const ev of events) {
            if (todayIndex === undefined) {
                result.push(ev);
                continue;
            }
            // Fully past day — skip (next-week events replace these)
            if (ev.dayOfWeek < todayIndex) continue;
            // Today: skip events that have fully ended before current hour
            if (ev.dayOfWeek === todayIndex && nowHour !== undefined && ev.endHour <= nowHour) continue;
            result.push(ev);
        }

        // Add next-week events for fully-past days AND today's past hours
        if (nextWeekEvents && todayIndex !== undefined) {
            for (const ev of nextWeekEvents) {
                if (ev.dayOfWeek < todayIndex) {
                    // Fully past day — show next week's event
                    result.push(ev);
                } else if (ev.dayOfWeek === todayIndex && nowHour !== undefined && ev.endHour <= nowHour) {
                    // Today but event ends before current hour — show next week's version
                    result.push(ev);
                }
            }
        }

        return result;
    }, [events, nextWeekEvents, todayIndex, currentHour]);

    const displayEvents = useMemo(() => getEventsForDisplay(), [getEventsForDisplay]);

    // Radial gradient centered on hovered cell — shows through grid gaps as feathered grid lines
    const gridLineBackground = useMemo(() => {
        if (hoverDay < 0 || !gridDims || !isInteractive) return undefined;
        const x = gridDims.colStartLeft + hoverDay * (gridDims.colWidth + gap) + gridDims.colWidth / 2;
        const y = gridDims.headerHeight + (hoverHour - rangeStart) * gridDims.rowHeight + gridDims.rowHeight / 2;
        return `radial-gradient(circle 100px at ${x}px ${y}px, var(--gt-hover-glow), transparent 80%)`;
    }, [hoverDay, hoverHour, gridDims, isInteractive, rangeStart]);

    return (
        <div className={`relative overflow-hidden ${className ?? ''}`}>
            {/* Tooltip */}
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
                style={{
                    gridTemplateColumns: '48px repeat(7, 1fr)',
                    touchAction: 'none',
                    background: gridLineBackground,
                }}
                onPointerUp={handlePointerUp}
                onPointerLeave={() => {
                    handlePointerUp();
                    setHoveredCell(null);
                }}
                data-testid="game-time-grid"
            >
                {/* Header row: timezone label corner + day labels */}
                <div className="sticky top-0 z-10 bg-surface flex items-center justify-center">
                    {tzLabel && (
                        <span className="text-[10px] text-dim font-medium">{tzLabel}</span>
                    )}
                </div>
                {DAYS.map((day, i) => {
                    const isToday = todayIndex === i;
                    const isTodaySplit = isToday && !!nextWeekSlots;
                    const isRollingPast = todayIndex !== undefined && nextWeekSlots && i < todayIndex;
                    const dateLabel = dayDates?.[i];
                    const nextDateLabel = nextWeekDayDates?.[i];
                    return (
                        <div
                            key={day}
                            className={`sticky top-0 z-10 text-center text-xs font-medium py-1 ${
                                isTodaySplit
                                    ? 'text-secondary'
                                    : isToday
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : isRollingPast
                                        ? 'bg-panel/80 text-dim'
                                        : 'bg-surface text-muted'
                            }`}
                            style={isTodaySplit ? {
                                background: 'linear-gradient(to right, var(--gt-split-bg) 50%, rgba(16, 185, 129, 0.15) 50%)',
                            } : undefined}
                            data-testid={`day-header-${i}`}
                        >
                            {isRollingPast && nextDateLabel ? (
                                <span className="flex flex-col items-center leading-none gap-0.5">
                                    <span>{day}</span>
                                    <span className="text-[9px] opacity-60 leading-none">{nextDateLabel}</span>
                                </span>
                            ) : isTodaySplit && dateLabel && nextDateLabel ? (
                                <span className="flex flex-col items-center leading-none gap-0.5">
                                    <span>{day}</span>
                                    <span className="text-[9px] leading-none flex items-center gap-0.5">
                                        <span className="text-muted">{nextDateLabel}</span>
                                        <span className="text-dim">/</span>
                                        <span className="text-emerald-400/80">{dateLabel}</span>
                                    </span>
                                </span>
                            ) : dateLabel ? (
                                <span className="flex flex-col items-center leading-none gap-0.5">
                                    <span>{day}</span>
                                    <span className="text-[9px] opacity-60 leading-none">{dateLabel}</span>
                                </span>
                            ) : (
                                day
                            )}
                        </div>
                    );
                })}

                {/* Hour rows */}
                {HOURS.map((hour) => (
                    <Fragment key={`row-${hour}`}>
                        {/* Hour label */}
                        <div
                            className="text-right text-xs text-dim pr-2 py-0.5 flex items-center justify-end"
                        >
                            {formatHour(hour)}
                        </div>

                        {/* Day cells for this hour */}
                        {DAYS.map((_, dayIndex) => {
                            const status = getSlotStatus(dayIndex, hour);
                            const locked = isCellLocked(dayIndex, hour);
                            const hasOverlay = eventCellSet.has(`${dayIndex}:${hour}`);
                            const cellClasses = getCellClasses(status, hasOverlay);
                            const past = isPastCell(dayIndex, hour);

                            // Merge adjacent same-status cells by removing shared border-radius edges
                            const group = getVisualGroup(status, hasOverlay);
                            const prevHour = hour - 1;
                            const nextHour = hour + 1;
                            const aboveStatus = prevHour >= rangeStart ? getSlotStatus(dayIndex, prevHour) : undefined;
                            const belowStatus = nextHour < rangeEnd ? getSlotStatus(dayIndex, nextHour) : undefined;
                            const aboveGroup = prevHour >= rangeStart ? getVisualGroup(aboveStatus, eventCellSet.has(`${dayIndex}:${prevHour}`)) : null;
                            const belowGroup = nextHour < rangeEnd ? getVisualGroup(belowStatus, eventCellSet.has(`${dayIndex}:${nextHour}`)) : null;
                            const sameAbove = aboveGroup === group;
                            const sameBelow = belowGroup === group;
                            const rounding = sameAbove && sameBelow ? '' : sameAbove ? 'rounded-b-sm' : sameBelow ? 'rounded-t-sm' : 'rounded-sm';

                            // Heatmap overlay (ROK-223)
                            const heatmapData = heatmapMap?.get(`${dayIndex}:${hour}`);
                            const heatmapIntensity = heatmapData
                                ? heatmapData.available / heatmapData.total
                                : 0;

                            // Hover: bright glow for paint, inverted red for erase, slate for locked
                            const isHovered = hoveredCell === `${dayIndex}:${hour}`;
                            const canInteract = isInteractive && !locked;
                            const clickable = !!onCellClick;
                            const isErase = status === 'available';

                            // Proximity grid lines: cells near cursor get an inset border that fades with distance
                            const dist = hoverDay >= 0
                                ? Math.max(Math.abs(dayIndex - hoverDay), Math.abs(hour - hoverHour))
                                : Infinity;

                            // Combined box-shadow: merge gap fill + proximity grid lines + hover ring/glow
                            const shadows: string[] = [];
                            if (sameAbove) shadows.push(`0 -1px 0 0 ${getMergeColor(group)}`);
                            if (isInteractive && dist > 0 && dist <= 4) {
                                const alpha = (0.28 - (dist - 1) * 0.06).toFixed(2);
                                shadows.push(`inset 0 0 0 0.5px rgba(var(--gt-proximity-line), ${alpha})`);
                            }
                            if (isHovered && isInteractive) {
                                if (locked) {
                                    // Locked cells: subtle slate ring so cursor is still visible
                                    shadows.push(`0 0 0 1.5px rgba(var(--gt-proximity-line), 0.5)`);
                                    shadows.push(`0 0 10px 1px rgba(var(--gt-proximity-line), 0.25)`);
                                } else {
                                    const ringColor = isErase
                                        ? 'rgba(248, 113, 113, 0.9)'
                                        : 'rgba(52, 211, 153, 0.95)';
                                    shadows.push(`0 0 0 2px ${ringColor}`);
                                    shadows.push(isErase
                                        ? '0 0 16px 2px rgba(248, 113, 113, 0.55)'
                                        : '0 0 16px 2px rgba(52, 211, 153, 0.6)');
                                }
                            }

                            // Heatmap background style
                            const heatmapBg = heatmapData
                                ? `rgba(16, 185, 129, ${(heatmapIntensity * 0.6).toFixed(2)})`
                                : undefined;

                            const cellStyle: React.CSSProperties = {
                                ...(shadows.length ? { boxShadow: shadows.join(', ') } : {}),
                                ...(heatmapBg ? { backgroundColor: heatmapBg } : {}),
                            };

                            return (
                                <div
                                    key={`${dayIndex}-${hour}`}
                                    className={`h-5 ${rounding} transition-colors ${heatmapBg ? '' : cellClasses} ${
                                        canInteract || clickable ? 'cursor-pointer' : locked ? 'cursor-not-allowed' : ''
                                    } ${past && nextWeekSlotMap && !isHovered ? 'opacity-60' : ''} ${
                                        isHovered && (isInteractive || clickable) ? 'z-10 relative' : ''
                                    }`}
                                    style={Object.keys(cellStyle).length ? cellStyle : undefined}
                                    data-testid={`cell-${dayIndex}-${hour}`}
                                    data-status={status ?? 'inactive'}
                                    title={heatmapData ? `${heatmapData.available} of ${heatmapData.total} players available` : undefined}
                                    onPointerDown={() => handlePointerDown(dayIndex, hour)}
                                    onPointerEnter={() => handlePointerEnter(dayIndex, hour)}
                                    onClick={clickable ? () => onCellClick!(dayIndex, hour) : undefined}
                                />
                            );
                        })}
                    </Fragment>
                ))}
            </div>

            {/* Rolling week divider — L-shaped border wrapping all "next week" cells */}
            {todayIndex !== undefined && nextWeekSlots && gridDims && currentHour !== undefined && (() => {
                const borderStyle = '2px dashed rgba(148, 163, 184, 0.3)';
                const totalHeight = HOURS.length * gridDims.rowHeight;
                const relativeHour = currentHour - rangeStart;
                const redLineY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));
                const todayLeft = gridDims.colStartLeft + todayIndex * (gridDims.colWidth + gap);
                const todayRight = todayLeft + gridDims.colWidth + gap;

                return (
                    <>
                        {/* Vertical left: red line → bottom (below the step) — only if todayIndex > 0 */}
                        {todayIndex > 0 && redLineY < totalHeight && (
                            <div
                                className="absolute z-[6] pointer-events-none"
                                style={{
                                    top: gridDims.headerHeight + redLineY,
                                    left: todayLeft - 1,
                                    width: 0,
                                    height: totalHeight - redLineY,
                                    borderLeft: borderStyle,
                                }}
                                data-testid="rolling-week-divider-left"
                            />
                        )}
                        {/* Horizontal: at red line, connecting left to right */}
                        {redLineY > 0 && (
                            <div
                                className="absolute z-[6] pointer-events-none"
                                style={{
                                    top: gridDims.headerHeight + redLineY,
                                    left: todayIndex > 0 ? todayLeft - 1 : todayLeft,
                                    width: todayIndex > 0 ? todayRight - todayLeft : gridDims.colWidth + gap,
                                    height: 0,
                                    borderTop: borderStyle,
                                }}
                                data-testid="rolling-week-divider-bottom"
                            />
                        )}
                        {/* Vertical right: top → red line (above the step) */}
                        {redLineY > 0 && (
                            <div
                                className="absolute z-[6] pointer-events-none"
                                style={{
                                    top: gridDims.headerHeight,
                                    left: todayRight - 1,
                                    width: 0,
                                    height: redLineY,
                                    borderLeft: borderStyle,
                                }}
                                data-testid="rolling-week-divider-right"
                            />
                        )}
                    </>
                );
            })()}

            {/* Today column highlight — split: grey above red line, green below */}
            {todayIndex !== undefined && gridDims && (() => {
                const colLeft = gridDims.colStartLeft + todayIndex * (gridDims.colWidth + gap);
                const totalHeight = HOURS.length * gridDims.rowHeight;

                // If rolling week is active and currentHour is known, split the column
                if (nextWeekSlots && currentHour !== undefined) {
                    const relativeHour = currentHour - rangeStart;
                    const splitY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));

                    return (
                        <>
                            {/* Grey "next week" portion above the red line */}
                            {splitY > 0 && (
                                <div
                                    className="absolute z-[5] pointer-events-none rounded-sm"
                                    style={{
                                        top: gridDims.headerHeight,
                                        left: colLeft,
                                        width: gridDims.colWidth,
                                        height: splitY,
                                        background: 'var(--gt-past-highlight)',
                                    }}
                                    data-testid="today-highlight-past"
                                />
                            )}
                            {/* Green "today" portion below the red line */}
                            {splitY < totalHeight && (
                                <div
                                    className="absolute z-[5] pointer-events-none rounded-sm"
                                    style={{
                                        top: gridDims.headerHeight + splitY,
                                        left: colLeft,
                                        width: gridDims.colWidth,
                                        height: totalHeight - splitY,
                                        background: 'rgba(16, 185, 129, 0.05)',
                                    }}
                                    data-testid="today-highlight"
                                />
                            )}
                        </>
                    );
                }

                // No rolling — full green highlight
                return (
                    <div
                        className="absolute z-[5] pointer-events-none rounded-sm"
                        style={{
                            top: gridDims.headerHeight,
                            left: colLeft,
                            width: gridDims.colWidth,
                            height: totalHeight,
                            background: 'rgba(16, 185, 129, 0.05)',
                        }}
                        data-testid="today-highlight"
                    />
                );
            })()}

            {/* Current time red line */}
            {todayIndex !== undefined && currentHour !== undefined && gridDims && (
                (() => {
                    const relativeHour = currentHour - rangeStart;
                    if (relativeHour < 0 || relativeHour > rangeEnd - rangeStart) return null;
                    const top = gridDims.headerHeight + relativeHour * gridDims.rowHeight;
                    const left = gridDims.colStartLeft + todayIndex * (gridDims.colWidth + gap);

                    return (
                        <div
                            className="absolute z-[25] pointer-events-none"
                            style={{
                                top: top - 1,
                                left: left - 4,
                                width: gridDims.colWidth + 8,
                                height: 0,
                            }}
                            data-testid="current-time-indicator"
                        >
                            {/* Red dot */}
                            <div
                                className="absolute rounded-full"
                                style={{
                                    width: 8,
                                    height: 8,
                                    top: -3,
                                    left: 0,
                                    background: '#ef4444',
                                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
                                }}
                            />
                            {/* Red line */}
                            <div
                                className="absolute"
                                style={{
                                    top: 0,
                                    left: 4,
                                    right: 0,
                                    height: 2,
                                    background: '#ef4444',
                                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
                                }}
                            />
                        </div>
                    );
                })()
            )}

            {/* Event block overlays */}
            {displayEvents.length > 0 && gridDims && (() => {
                const dayEventCounts = new Map<string, number>();

                return displayEvents.map((ev) => {
                    // Filter to visible hour range
                    const visStart = Math.max(ev.startHour, rangeStart);
                    const visEnd = Math.min(ev.endHour, rangeEnd);
                    if (visStart >= visEnd) return null;

                    const spanHours = visEnd - visStart;
                    const top = gridDims.headerHeight + (visStart - rangeStart) * gridDims.rowHeight;
                    const height = spanHours * gridDims.rowHeight - 1;

                    const dayKey = `${ev.dayOfWeek}:${visStart}`;
                    const stackIndex = dayEventCounts.get(dayKey) ?? 0;
                    dayEventCounts.set(dayKey, stackIndex + 1);
                    const stackOffset = stackIndex * 2;

                    const left = gridDims.colStartLeft + ev.dayOfWeek * (gridDims.colWidth + gap) + stackOffset;
                    const width = gridDims.colWidth - stackOffset;

                    return (
                        <div
                            key={`event-${ev.eventId}-${ev.dayOfWeek}`}
                            className="absolute z-20 rounded-sm overflow-hidden cursor-pointer hover:brightness-110 transition-all"
                            style={{
                                top,
                                left,
                                width: Math.max(width, 0),
                                height: Math.max(height, 0),
                                ...getGameTimeBlockStyle(ev.gameSlug ?? undefined, ev.coverUrl),
                            }}
                            data-testid={`event-block-${ev.eventId}-${ev.dayOfWeek}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEventClick?.(ev, (e.currentTarget as HTMLElement).getBoundingClientRect());
                            }}
                            title={`${ev.title}${ev.gameName ? ` (${ev.gameName})` : ''}`}
                        >
                            <RichEventBlock
                                event={{
                                    title: ev.title,
                                    gameName: ev.gameName,
                                    gameSlug: ev.gameSlug,
                                    gameRegistryId: ev.gameRegistryId,
                                    coverUrl: ev.coverUrl,
                                    startHour: ev.startHour,
                                    endHour: ev.endHour,
                                    description: ev.description,
                                    creatorUsername: ev.creatorUsername,
                                    signupsPreview: ev.signupsPreview,
                                    signupCount: ev.signupCount,
                                }}
                                spanHours={ev.endHour - ev.startHour}
                            />
                        </div>
                    );
                });
            })()}

            {/* Preview block overlays (dashed border for current event) */}
            {previewBlocks && previewBlocks.length > 0 && gridDims && (() => {
                return previewBlocks.map((block, i) => {
                    const visStart = Math.max(block.startHour, rangeStart);
                    const visEnd = Math.min(block.endHour, rangeEnd);
                    if (visStart >= visEnd) return null;

                    const spanHours = visEnd - visStart;
                    const top = gridDims.headerHeight + (visStart - rangeStart) * gridDims.rowHeight;
                    const height = spanHours * gridDims.rowHeight - 1;
                    const left = gridDims.colStartLeft + block.dayOfWeek * (gridDims.colWidth + gap);
                    const width = gridDims.colWidth;

                    // Check if an event block already covers this position — if so, border only
                    const hasEventUnderneath = displayEvents.some(
                        (ev) => ev.dayOfWeek === block.dayOfWeek && ev.startHour < block.endHour && ev.endHour > block.startHour,
                    );

                    // ROK-223: variant styling
                    const isSelected = block.variant === 'selected';
                    const borderStyle = isSelected
                        ? '2px solid rgba(16, 185, 129, 0.8)'
                        : '2px dashed rgba(251, 191, 36, 0.7)';
                    const shadowStyle = isSelected
                        ? '0 0 12px rgba(16, 185, 129, 0.3), inset 0 0 8px rgba(16, 185, 129, 0.1)'
                        : '0 0 12px rgba(251, 191, 36, 0.25), inset 0 0 8px rgba(251, 191, 36, 0.08)';

                    return (
                        <div
                            key={`preview-${block.dayOfWeek}-${block.startHour}-${i}`}
                            className="absolute z-[21] rounded-sm pointer-events-none"
                            style={{
                                top,
                                left,
                                width: Math.max(width, 0),
                                height: Math.max(height, 0),
                                border: borderStyle,
                                boxShadow: shadowStyle,
                            }}
                            data-testid={`preview-block-${block.dayOfWeek}-${block.startHour}`}
                        >
                            {/* Show content only when no event block underneath */}
                            {!hasEventUnderneath && block.title && (
                                <RichEventBlock
                                    event={{
                                        title: block.title ?? block.label ?? 'Event',
                                        gameName: block.gameName,
                                        gameSlug: block.gameSlug,
                                        coverUrl: block.coverUrl,
                                        startHour: block.startHour,
                                        endHour: block.endHour,
                                        description: block.description,
                                        creatorUsername: block.creatorUsername,
                                        signupsPreview: block.attendees,
                                        signupCount: block.attendeeCount,
                                    }}
                                    spanHours={block.endHour - block.startHour}
                                />
                            )}
                        </div>
                    );
                });
            })()}
        </div>
    );
}
