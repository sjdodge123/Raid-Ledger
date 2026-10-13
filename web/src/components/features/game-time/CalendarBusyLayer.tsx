import { useMemo, type JSX } from 'react';
import type { GameTimeCalendarBusy, GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from './game-time-grid.types';
import { busyBandLabel, busyInsideGameTime, busyRunsForDays, type BusyRun } from './calendar-busy.utils';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface CalendarBusyLayerProps {
    /** `GameTimeResponse.calendarBusy`; absent or empty draws nothing. */
    busy?: readonly GameTimeCalendarBusy[] | undefined;
    /** The viewer's game time: a band draws only on its free hours (operator R5). */
    slots: readonly GameTimeSlot[];
    gridDims: GridDims;
    /** Visible hours, in the grid's order (the block layer's index space). */
    hours: number[];
    /** Days rendered left to right. The phone passes the one day on screen. */
    days?: number[] | undefined;
}

/**
 * The viewer's own synced-calendar busy hours, drawn over their game time
 * (ROK-1595 S2, design-system NP-1 "own-calendar busy band").
 *
 * A translucent `bg-busy/30` band (operator R4: 30%, was 20%) with a solid `border-busy` left edge and the
 * label "Busy · Google Calendar". It sits ABOVE the slot blocks so it reads over
 * a free block, and is `pointer-events-none` throughout, so every tap and drag
 * falls through to the block editor underneath. Renders exactly what
 * `calendarBusy` says, clipped to the viewer's free hours (operator R5): a busy
 * hour outside their game time draws nothing. Own-copy dedupe is the server's job (D6).
 */
export function CalendarBusyLayer({ busy, slots, gridDims, hours, days = ALL_DAYS }: CalendarBusyLayerProps): JSX.Element | null {
    const runs = useMemo(
        () => busyRunsForDays(busyInsideGameTime(busy ?? [], slots), days, hours), [busy, slots, days, hours],
    );
    if (runs.length === 0) return null;
    return (
        <div className="pointer-events-none absolute inset-0 z-[9]" data-testid="calendar-busy-layer">
            {runs.map((run) => (
                <BusyBand
                    key={`${run.dayOfWeek}-${run.startIndex}`} run={run} gridDims={gridDims}
                    col={days.indexOf(run.dayOfWeek)} startHour={hours[run.startIndex] ?? run.startIndex}
                />
            ))}
        </div>
    );
}

function BusyBand({ run, gridDims, col, startHour }: {
    run: BusyRun; gridDims: GridDims; col: number; startHour: number;
}): JSX.Element {
    const label = busyBandLabel(run.provider);
    return (
        <div
            className="pointer-events-none absolute overflow-hidden rounded-sm border-l-4 border-busy bg-busy/30 px-1.5 py-0.5"
            style={{
                top: gridDims.headerHeight + run.startIndex * gridDims.rowHeight + 1,
                left: gridDims.colStartLeft + col * (gridDims.colWidth + 1),
                width: gridDims.colWidth,
                height: Math.max((run.endIndex - run.startIndex) * gridDims.rowHeight - 2, 0),
            }}
            data-testid={`calendar-busy-band-${run.dayOfWeek}-${startHour}`}
            title={label}
        >
            <span className="block truncate text-[10px] font-medium leading-tight text-foreground">{label}</span>
        </div>
    );
}
