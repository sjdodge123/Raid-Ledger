import type { JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { getGameTimeBlockStyle } from '../../../../constants/game-colors';
import { votedLabel, type SlotMark } from '../slot-marks.utils';
import { blockGeometry, type HourRange } from './group-day.utils';

/**
 * The marks drawn over the phone's group day (ROK-1587, approved board P-a).
 *
 * Everything here is positioned in PERCENT of the visible hours — the rows of
 * `GroupDayView` are equal `1fr` tracks, so no measurement pass is needed.
 * Stacking inside the overlay is DOM order: the viewer's events, slot blocks,
 * then the suggestion (1587-5); the cell counts sit above all of it.
 */

/**
 * One of the viewer's own events on this day (ROK-1588 operator ruling
 * 2026-09-17), replacing the "you" bar: the counts already include the viewer,
 * so what the group view lacked was what they are already COMMITTED to. The
 * profile grid's event styling, titled, over the left of the row so the
 * right-aligned counts stay readable.
 */
export function DayEventBlock({ event, range, hours }: {
    event: GameTimeEventBlock; range: HourRange; hours: number[];
}): JSX.Element {
    return (
        <div
            data-testid={`phone-group-event-${event.eventId}`}
            data-start-hour={hours[range.startIndex]}
            className="absolute left-1.5 w-[55%] overflow-hidden rounded-md px-1.5 py-0.5"
            style={{
                ...blockGeometry(range.startIndex, range.endIndex, hours.length),
                ...getGameTimeBlockStyle(event.gameSlug ?? undefined, event.coverUrl),
            }}
        >
            <span className="block truncate text-[11px] font-semibold leading-tight text-foreground">{event.title}</span>
        </div>
    );
}

/**
 * A poll slot that has already been suggested — a dashed `--color-slot` block
 * on its start hour (poll slots carry no duration, so one row; Q1) with an
 * "N voted" chip bottom-right. `null` when the hour is not on screen, so a
 * slot outside the window never paints past the day.
 */
export function SlotBlock({ mark, hours }: { mark: SlotMark; hours: number[] }): JSX.Element | null {
    const index = hours.indexOf(mark.hour);
    if (index < 0) return null;
    return (
        <div
            data-testid={`phone-group-slot-block-${mark.hour}`}
            className="absolute inset-x-1 rounded-md border-2 border-dashed border-slot bg-slot/10"
            style={blockGeometry(index, index + 1, hours.length)}
        >
            <span
                data-testid="phone-group-slot-chip"
                className="absolute bottom-1 right-1.5 rounded-full border border-slot bg-surface px-[7px] text-[11px] font-semibold leading-4 text-slot"
            >
                {votedLabel(mark.votes)}
            </span>
        </div>
    );
}
