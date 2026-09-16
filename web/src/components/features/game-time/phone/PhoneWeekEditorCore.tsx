import type { JSX, ReactNode } from 'react';
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
    /** Day to open on, grid convention (0 = Sunday). */
    initialDay?: number;
    /** Told which day is on screen, for a caller that mirrors it elsewhere. */
    onDayChange?: (day: number) => void;
    /** Pre-measured dims — see `DayBlockEditor`. */
    dims?: GridDims;
    /** Where the block inspector goes — see `DayBlockEditor`. */
    inspectorPlacement?: 'flow' | 'fixed';
    /**
     * Rendered between the pager and the day, where the comp puts the profile's
     * "Show earlier" row (ROK-1579 frame 3). The editor itself stays actionless.
     */
    gridHeader?: ReactNode;
    /** Attached to the day slot, for a caller that sizes its window to it. */
    daySlotRef?: React.Ref<HTMLDivElement>;
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
    slots, onChange, hours, initialDay = 0, onDayChange, dims, inspectorPlacement,
    gridHeader, daySlotRef,
}: PhoneWeekEditorCoreProps): JSX.Element {
    const pager = usePhoneWeekEditor(slots, hours, initialDay, onDayChange);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="phone-week-editor">
            <DayPager day={pager.day} freeHours={pager.freeHours} onPrev={pager.goPrev} onNext={pager.goNext} />
            {gridHeader}
            {/* ROK-1579: a FLOOR of three 44px rows, not `min-h-0`. The day is
                the only flexible child, so an absence panel opening below used
                to squeeze it to zero while its hour labels kept painting over
                the strip. It now bottoms out here and scrolls inside itself. */}
            <div
                ref={daySlotRef} className="min-h-[132px] flex-1" data-testid="phone-day-editor"
                {...pager.swipeHandlers}
            >
                <DayBlockEditor
                    slots={slots} onChange={onChange} dayOfWeek={pager.day} hours={hours} dims={dims}
                    inspectorPlacement={inspectorPlacement}
                />
            </div>
            <WeekStrip slots={slots} hours={hours} day={pager.day} onPick={pager.setDay} />
        </div>
    );
}
