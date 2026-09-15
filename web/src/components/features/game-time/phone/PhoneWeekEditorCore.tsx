import type { JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { DayBlockEditor } from './DayBlockEditor';
import { DayPager } from './DayPager';
import { WeekStrip } from './WeekStrip';
import { usePhoneWeekEditor } from './use-phone-week-editor';

export interface PhoneWeekEditorCoreProps {
    slots: GameTimeSlot[];
    onChange?: (slots: GameTimeSlot[]) => void;
    /** Visible hours, in the caller's order — e.g. `[17..23]` for the evening. */
    hours: number[];
    /** Hatch the unclaimed hours: the viewer's saved week is older than the freshness window. */
    stale?: boolean;
    /** Day to open on, grid convention (0 = Sunday). */
    initialDay?: number;
    /** Told which day is on screen, for a caller that mirrors it elsewhere. */
    onDayChange?: (day: number) => void;
    /** Pre-measured dims — see `DayBlockEditor`. */
    dims?: GridDims;
}

/**
 * The phone week editor, without any of the answers around it (ROK-1569).
 *
 * One day fills the sheet, paged by the header arrows, a horizontal swipe or a
 * tap in the week strip. This component deliberately carries NO actions — no
 * "Same as last week", no absence row, no Save/Skip — so the same editor can be
 * mounted inside the poll's step 1 and anywhere else a week needs editing.
 */
export function PhoneWeekEditorCore({
    slots, onChange, hours, stale = false, initialDay = 0, onDayChange, dims,
}: PhoneWeekEditorCoreProps): JSX.Element {
    const pager = usePhoneWeekEditor(slots, hours, initialDay, onDayChange);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="phone-week-editor">
            <DayPager day={pager.day} freeHours={pager.freeHours} onPrev={pager.goPrev} onNext={pager.goNext} />
            <div className="min-h-0 flex-1" data-testid="phone-day-editor" {...pager.swipeHandlers}>
                <DayBlockEditor
                    slots={slots} onChange={onChange} dayOfWeek={pager.day} hours={hours} stale={stale} dims={dims}
                />
            </div>
            <WeekStrip slots={slots} hours={hours} day={pager.day} stale={stale} onPick={pager.setDay} />
        </div>
    );
}
