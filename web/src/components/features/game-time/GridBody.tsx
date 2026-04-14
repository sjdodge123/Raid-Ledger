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

export interface GridBodyProps extends CellRenderProps {
    gridRef: React.RefObject<HTMLDivElement | null>;
    gridLineBackground: string | undefined;
    handlePointerUp: () => void;
    setHoveredCell: (v: string | null) => void;
    tzLabel?: string;
    noStickyOffset?: boolean;
    isHeaderHidden: boolean;
    dayDates: string[] | null;
    nextWeekDayDates: string[] | null;
    fullDayNames?: boolean;
    todayIndex?: number;
    nextWeekSlots?: GameTimeSlot[];
    HOURS: number[];
    /** Callback when a day header is clicked (for whole-day toggle) */
    onDayClick?: (dayIndex: number) => void;
    /** Returns whether all 24 hours are active for a given day (drives aria-pressed on DayHeader) */
    isDayAllActive?: (dayIndex: number) => boolean;
}

/** Inner grid with day headers and cell rows */
export function GridBody({
    gridRef, gridLineBackground, handlePointerUp, setHoveredCell,
    tzLabel, noStickyOffset, isHeaderHidden,
    dayDates, nextWeekDayDates, fullDayNames, todayIndex, nextWeekSlots,
    HOURS, onDayClick, isDayAllActive, ...cellProps
}: GridBodyProps): JSX.Element {
    return (
        <div
            ref={gridRef} className="grid gap-px select-none"
            style={{ gridTemplateColumns: '52px repeat(7, 1fr)', touchAction: 'none', background: gridLineBackground }}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => { handlePointerUp(); setHoveredCell(null); }}
            data-testid="game-time-grid"
        >
            <TzCorner tzLabel={tzLabel} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden} />
            <DayHeaders dayDates={dayDates} nextWeekDayDates={nextWeekDayDates} fullDayNames={fullDayNames} todayIndex={todayIndex} nextWeekSlots={nextWeekSlots} noStickyOffset={noStickyOffset} isHeaderHidden={isHeaderHidden} onDayClick={onDayClick} isDayAllActive={isDayAllActive} />
            {HOURS.map((hour) => <HourRow key={`row-${hour}`} hour={hour} {...cellProps} />)}
        </div>
    );
}

function TzCorner({ tzLabel, noStickyOffset, isHeaderHidden }: {
    tzLabel?: string; noStickyOffset?: boolean; isHeaderHidden: boolean;
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

function DayHeaders({ dayDates, nextWeekDayDates, fullDayNames, todayIndex, nextWeekSlots, noStickyOffset, isHeaderHidden, onDayClick, isDayAllActive }: {
    dayDates: string[] | null; nextWeekDayDates: string[] | null;
    fullDayNames?: boolean; todayIndex?: number; nextWeekSlots?: GameTimeSlot[];
    noStickyOffset?: boolean; isHeaderHidden: boolean; onDayClick?: (dayIndex: number) => void;
    isDayAllActive?: (dayIndex: number) => boolean;
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
