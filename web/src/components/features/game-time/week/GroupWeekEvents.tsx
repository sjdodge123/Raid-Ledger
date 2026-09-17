import type { CSSProperties, JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { getGameTimeBlockStyle } from '../../../../constants/game-colors';
import { eventHourRuns } from './viewer-week-events';

/** `GroupWeekView`'s fixed geometry: 56px gutter, `h-11` header, `h-10` hour rows. */
const GUTTER_PX = 56;
const HEADER_PX = 44;
const ROW_PX = 40;

/**
 * The block covers the LEFT of its day column only, so the group's counts
 * (top-right of every cell) stay readable under a committed event.
 */
function blockStyle(event: GameTimeEventBlock, startIndex: number, endIndex: number): CSSProperties {
    const column = `((100% - ${GUTTER_PX}px) / 7)`;
    return {
        left: `calc(${GUTTER_PX}px + ${column} * ${event.dayOfWeek} + 5px)`,
        width: `calc(${column} * 0.55)`,
        top: HEADER_PX + startIndex * ROW_PX + 2,
        height: (endIndex - startIndex) * ROW_PX - 4,
        ...getGameTimeBlockStyle(event.gameSlug ?? undefined, event.coverUrl),
    };
}

/**
 * The viewer's own events over the desktop group week (ROK-1588 operator
 * ruling 2026-09-17) — the profile grid's event styling, one block per
 * visible run of hours, titled. `pointer-events-none`: the cells beneath stay
 * pickable, and a busy hour is still the viewer's call to make.
 */
export function GroupWeekEvents({ events, hours }: {
    events: GameTimeEventBlock[]; hours: number[];
}): JSX.Element {
    return (
        <>
            {events.flatMap((event) => eventHourRuns(event, hours).map((run) => (
                <div key={`${event.eventId}-${event.dayOfWeek}-${run.startIndex}`}
                    data-testid={`group-week-event-${event.eventId}`}
                    data-day={event.dayOfWeek} data-start-hour={hours[run.startIndex]}
                    className="pointer-events-none absolute z-10 overflow-hidden rounded-sm px-1 py-0.5"
                    style={blockStyle(event, run.startIndex, run.endIndex)}>
                    <span className="block truncate text-[10px] font-semibold leading-tight text-foreground">
                        {event.title}
                    </span>
                </div>
            )))}
        </>
    );
}
