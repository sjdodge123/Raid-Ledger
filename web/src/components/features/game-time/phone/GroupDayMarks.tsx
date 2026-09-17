import type { JSX } from 'react';
import { votedLabel, type SlotMark } from '../slot-marks.utils';
import { blockGeometry, type HourRange } from './group-day.utils';

/**
 * The marks drawn over the phone's group day (ROK-1587, approved board P-a).
 *
 * Everything here is positioned in PERCENT of the visible hours — the rows of
 * `GroupDayView` are equal `1fr` tracks, so no measurement pass is needed.
 * Stacking inside the overlay is DOM order: you-bar, slot blocks, then the
 * suggestion (1587-5); the cell counts sit above all of it.
 */

/**
 * The viewer's own saved hours — a 4px solid bar flush against the gutter.
 *
 * It replaced ROK-1580's dashed "You · 7 – 10 PM" outline: the outline and the
 * dashed slot blocks would read as the same mark, and the label fought the
 * counts for the row. Decorative (the legend names it), so it is aria-hidden.
 */
export function YouBar({ block, hours }: { block: HourRange; hours: number[] }): JSX.Element {
    return (
        <div
            data-testid="phone-group-you-bar"
            aria-hidden="true"
            className="absolute left-0 w-1 rounded-sm bg-foreground/70"
            style={blockGeometry(block.startIndex, block.endIndex, hours.length)}
        />
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
