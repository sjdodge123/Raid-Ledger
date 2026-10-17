import type { JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { getGameTimeBlockStyle } from '../../../../constants/game-colors';
import { formatHour } from '../game-time-grid.utils';
import { marksOutsideHours, votedLabel, type SlotMark } from '../slot-marks.utils';
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

/**
 * "1 more suggested outside 5 PM – 11 PM" (TDB:1795 / ROK-1584, discovery
 * option A). The phone day shows a fixed window, so a slot outside it draws no
 * block (`SlotBlock` → null) while the week strip's "● N" still counts it. This
 * line is read off the same marks map the strip counts, so blocks + N always
 * add up to the strip. Nothing when every mark of the day is on screen.
 */
export function OutsideHoursHint({ slotMarks, dayOfWeek, hours }: {
    slotMarks?: Map<string, SlotMark> | undefined; dayOfWeek: number; hours: number[];
}): JSX.Element | null {
    const outside = marksOutsideHours(slotMarks, dayOfWeek, hours).length;
    const first = hours[0];
    const last = hours[hours.length - 1];
    if (outside === 0 || first === undefined || last === undefined) return null;
    return (
        <p data-testid="phone-group-outside-hint" className="flex-none px-1 pt-1 text-[11px] text-muted">
            {`${outside} more suggested outside ${formatHour(first)} – ${formatHour(last)}`}
        </p>
    );
}
