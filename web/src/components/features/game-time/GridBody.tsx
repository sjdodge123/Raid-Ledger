import type { JSX } from 'react';
import { Fragment } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { DAYS, formatHour } from './game-time-grid.utils';
import { DayHeader } from './DayHeader';
import { GridCell } from './GridCell';

/** Shared props for cell-rendering sub-components */
export interface CellRenderProps {
    rangeStart: number;
    rangeEnd: number;
    compact?: boolean | undefined;
    getSlotStatus: (d: number, h: number) => string | undefined;
    isCellLocked: (d: number, h: number) => boolean;
    isPastCell: (d: number, h: number) => boolean;
    eventCellSet: Set<string>;
    hoveredCell: string | null;
    hoverDay: number;
    hoverHour: number;
    isInteractive: boolean;
    nextWeekSlotMap: Map<string, GameTimeSlot> | null;
    onCellClick?: ((d: number, h: number) => void) | undefined;
    onPointerEnter: (d: number, h: number) => void;
    /** Days the viewer is away this week (ROK-1585) — muted header + column. */
    awayDays?: ReadonlySet<number> | undefined;
}

export interface GridBodyProps extends CellRenderProps {
    gridRef: React.RefObject<HTMLDivElement | null>;
    gridLineBackground: string | undefined;
    setHoveredCell: (v: string | null) => void;
    tzLabel?: string | undefined;
    noStickyOffset?: boolean | undefined;
    isHeaderHidden: boolean;
    dayDates: string[] | null;
    nextWeekDayDates: string[] | null;
    fullDayNames?: boolean | undefined;
    todayIndex?: number | undefined;
    nextWeekSlots?: GameTimeSlot[] | undefined;
    HOURS: number[];
    /** Callback when a day header is clicked (for whole-day toggle) */
    onDayClick?: ((dayIndex: number) => void) | undefined;
    /** Returns whether all 24 hours are active for a given day (drives aria-pressed on DayHeader) */
    isDayAllActive?: ((dayIndex: number) => boolean) | undefined;
}

/** Inner grid with day headers and cell rows */
export function GridBody({
    gridRef, gridLineBackground, setHoveredCell,
    tzLabel, noStickyOffset, isHeaderHidden,
    dayDates, nextWeekDayDates, fullDayNames, todayIndex, nextWeekSlots,
    HOURS, onDayClick, isDayAllActive, ...cellProps
}: GridBodyProps): JSX.Element {
    // ROK-1426: the grid NEVER captures touch gestures any more. Editing happens
    // in the block layer above it, where only a selected block and its handles
    // set touch-action: none -- so the page scrolls from anywhere in the grid.
    return (
        <div
            ref={gridRef} className="grid gap-px select-none"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)', touchAction: 'pan-y', background: gridLineBackground }}
            onPointerLeave={() => setHoveredCell(null)}
            data-testid="game-time-grid"
        >
            <TzCorner tzLabel={tzLabel} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden} />
            <DayHeaders dayDates={dayDates} nextWeekDayDates={nextWeekDayDates} fullDayNames={fullDayNames} todayIndex={todayIndex} nextWeekSlots={nextWeekSlots} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden} onDayClick={onDayClick} isDayAllActive={isDayAllActive} awayDays={cellProps.awayDays} />
            {HOURS.map((hour) => <HourRow key={`row-${hour}`} hour={hour} {...cellProps} />)}
        </div>
    );
}

function TzCorner({ tzLabel, noStickyOffset, isHeaderHidden }: {
    tzLabel?: string | undefined; noStickyOffset?: boolean | undefined; isHeaderHidden: boolean;
}): JSX.Element {
    return (
        <div
            className={`sticky ${noStickyOffset ? 'top-0' : isHeaderHidden ? 'top-0' : 'top-16'} z-10 bg-surface flex items-center justify-center`}
            style={{ transition: noStickyOffset ? undefined : 'top 300ms ease-in-out' }}
        >
            {tzLabel && <span className="text-xs text-dim font-medium">{tzLabel}</span>}
        </div>
    );
}

function DayHeaders({ dayDates, nextWeekDayDates, fullDayNames, todayIndex, nextWeekSlots, noStickyOffset, isHeaderHidden, onDayClick, isDayAllActive, awayDays }: {
    dayDates: string[] | null; nextWeekDayDates: string[] | null;
    fullDayNames?: boolean | undefined; todayIndex?: number | undefined; nextWeekSlots?: GameTimeSlot[] | undefined;
    noStickyOffset?: boolean | undefined; isHeaderHidden: boolean; onDayClick?: ((dayIndex: number) => void) | undefined;
    isDayAllActive?: ((dayIndex: number) => boolean) | undefined; awayDays?: ReadonlySet<number> | undefined;
}): JSX.Element {
    return (
        <>
            {DAYS.map((day, i) => (
                <DayHeader
                    key={day} dayIndex={i} fullDayNames={fullDayNames}
                    todayIndex={todayIndex} hasRolling={!!nextWeekSlots}
                    dateLabel={dayDates?.[i]} nextDateLabel={nextWeekDayDates?.[i]}
                    noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden}
                    onClick={onDayClick ? () => onDayClick(i) : undefined}
                    isAllActive={isDayAllActive?.(i)}
                    isAway={awayDays?.has(i)}
                />
            ))}
        </>
    );
}

/** Single hour row: label + 7 grid cells */
function HourRow({ hour, ...cellProps }: { hour: number } & CellRenderProps): JSX.Element {
    return (
        <Fragment>
            <div className="text-right text-sm text-dim pr-2 py-0.5 flex items-center justify-end">
                {formatHour(hour)}
            </div>
            {DAYS.map((_, dayIndex) => (
                <GridCell key={`${dayIndex}-${hour}`} dayIndex={dayIndex} hour={hour} {...cellProps} />
            ))}
        </Fragment>
    );
}
