import { useMemo, useState, type JSX } from 'react';
import type { AggregateGameTimeResponse, GameTimeEventBlock } from '@raid-ledger/contract';
import type { HeatmapCellData } from '../features/game-time/game-time-grid.types';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { fillUnknownCells, memberCountsFrom } from '../../pages/scheduling/availability-freshness';
import { toGroupCellMap } from '../features/game-time/phone/group-day.utils';
import { cellInstant, cellTimeLabel } from '../features/game-time/slot-marks.utils';
import { GroupWeekView, type WeekCellRef } from '../features/game-time/week/GroupWeekView';
import { useViewerWeekEvents } from '../features/game-time/week/viewer-week-events';
import { PhoneGroupAvailability } from '../lineups/cycle-4/PhoneGroupAvailability';
import { getWeekStart } from '../lineups/cycle-4/scheduling-availability';
import { cellInWeek, isCellBlocked, toLocalInput } from './reschedule-utils';

export interface RescheduleGridProps {
    /** The events aggregate for the event's signed-up players. */
    data: AggregateGameTimeResponse | undefined;
    isLoading: boolean;
    /** The event's current start. */
    currentStart: Date;
    /** The start picked from the grid (null when typed by hand or cleared). */
    picked: Date | null;
    /** A pickable cell was chosen: its `datetime-local` value and its cell. */
    onPick: (value: string, cell: WeekCellRef) => void;
    /** The event being rescheduled — left off the viewer's events (it shows as "Current"). */
    eventId?: number;
}

const LOADING_COPY = 'Loading availability data...';
const EMPTY_COPY = 'No players signed up yet -- no availability data to display.';
/** Signups exist but none has a game-time template, so the aggregate has no cells (review P2). */
const NO_GAME_TIME_COPY = 'Nobody signed up has set their game time yet — type a new start below.';

/** The week to open on: the event's week when it is still ahead, else this week. */
function openingWeek(currentStart: Date): Date {
    const now = new Date();
    return getWeekStart(currentStart > now ? currentStart : now);
}

/** Displayed-week state; paging is date-only (the events aggregate is undated). */
function useRescheduleWeek(currentStart: Date): [Date, (delta: number) => void] {
    const [weekStart, setWeekStart] = useState(() => openingWeek(currentStart));
    const step = (delta: number) => setWeekStart((week) => getWeekStart(cellInstant(week, 7 * delta, 12)));
    return [weekStart, step];
}

function GridMessage({ text }: { text: string }): JSX.Element {
    return <div className="flex items-center justify-center py-12 text-muted">{text}</div>;
}

/** "Currently Wed Sep 23, 8 PM. Pick a new time; everyone signed up is notified." */
function CurrentNote({ currentStart }: { currentStart: Date }): JSX.Element {
    const label = cellTimeLabel(getWeekStart(currentStart), currentStart.getDay(), currentStart.getHours(), true);
    return (
        <p data-testid="reschedule-current" className="shrink-0 text-sm text-muted">
            Currently <span className="font-semibold text-foreground">{label}</span>.
            {' '}Pick a new time; everyone signed up is notified.
        </p>
    );
}

interface DesktopBodyProps {
    data: AggregateGameTimeResponse;
    cells: Map<string, HeatmapCellData>;
    events: GameTimeEventBlock[];
    weekStart: Date;
    currentStart: Date;
    picked: WeekCellRef | null;
    onPick: (day: number, hour: number) => void;
    onWeekChange: (delta: number) => void;
}

/** Desktop: the "Currently …" note above the shared week-columns view. */
function DesktopBody(p: DesktopBodyProps): JSX.Element {
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <CurrentNote currentStart={p.currentStart} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <GroupWeekView weekStart={p.weekStart} cells={p.cells} events={p.events}
                    picked={p.picked} current={cellInWeek(p.currentStart, p.weekStart)}
                    isCellDisabled={(day, hour) => isCellBlocked(p.weekStart, p.currentStart, day, hour)}
                    onPick={p.onPick} onWeekChange={p.onWeekChange}
                    legend={{ memberCounts: memberCountsFrom(p.data) }} />
            </div>
        </div>
    );
}

/**
 * Reschedule's availability picker (ROK-1588 R): the shared week-columns view
 * on desktop, the ROK-1580 one-day group module on phones. A pick lands on the
 * DISPLAYED week's date — not the weekday's next occurrence.
 */
export function RescheduleGrid(props: RescheduleGridProps): JSX.Element {
    const { data, isLoading, currentStart, picked, onPick, eventId } = props;
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const [weekStart, stepWeek] = useRescheduleWeek(currentStart);
    // Phones fetch inside `PhoneGroupAvailability`; this read is the desktop's.
    const events = useViewerWeekEvents(weekStart, { enabled: isDesktop, excludeEventId: eventId });
    const cells = useMemo(() => toGroupCellMap(data ? fillUnknownCells(data) : []), [data]);

    if (isLoading) return <GridMessage text={LOADING_COPY} />;
    if (!data || data.totalUsers === 0) return <GridMessage text={EMPTY_COPY} />;

    const pick = (day: number, hour: number) => {
        if (isCellBlocked(weekStart, currentStart, day, hour)) return;
        onPick(toLocalInput(cellInstant(weekStart, day, hour)), { dayOfWeek: day, hour });
    };
    const pickedCell = cellInWeek(picked, weekStart);

    if (!isDesktop) {
        // The phone module renders nothing without cells; say why instead of
        // leaving a blank sheet (the desktop week view draws its empty grid).
        if (cells.size === 0) return <GridMessage text={NO_GAME_TIME_COPY} />;
        return (
            <div className="h-[55vh] min-h-0 shrink-0">
                <PhoneGroupAvailability data={data} isLoading={false} weekStart={weekStart}
                    onWeekChange={stepWeek} readOnly={false} onPickHour={pick} suggested={pickedCell}
                    sizeNoun="signed up" excludeEventId={eventId} />
            </div>
        );
    }
    return (
        <DesktopBody data={data} cells={cells} events={events} weekStart={weekStart}
            currentStart={currentStart} picked={pickedCell} onPick={pick} onWeekChange={stepWeek} />
    );
}
