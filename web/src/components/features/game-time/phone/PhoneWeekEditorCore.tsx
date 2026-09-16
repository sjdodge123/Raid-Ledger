import { useMemo, type JSX, type ReactNode } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { BlockPresetControl } from '../block-presets';
import type { GridDims, HeatmapCellData } from '../game-time-grid.types';
import { DayBlockEditor } from './DayBlockEditor';
import { DayPager } from './DayPager';
import { GroupDayView } from './GroupDayView';
import { WeekStrip } from './WeekStrip';
import { groupBandKind, groupBandShares, type GroupBandKind } from './group-day.utils';
import { usePhoneWeekEditor } from './use-phone-week-editor';

/**
 * Everything the editor needs to show the GROUP instead of the viewer
 * (ROK-1580). Its presence is what switches the shell into read-only poll mode.
 */
export interface GroupOverlay {
    /** The poll aggregate, keyed by `groupCellKey` — see `toGroupCellMap`. */
    cells: Map<string, HeatmapCellData>;
    /** The viewer's own saved week, outlined over the group's fill. */
    viewerSlots: GameTimeSlot[];
    /** The hour the viewer last tapped, drawn as a two-hour suggestion. */
    suggested?: { dayOfWeek: number; hour: number } | null;
    onPickHour: (dayOfWeek: number, hour: number) => void;
    /** Replaces "3h free" under the day name — e.g. "Sep 16 · 4 in poll". */
    subtitle?: string;
    /** Given when paging past an end should fetch the neighbouring week. */
    onWeekStep?: (delta: -1 | 1) => void;
}

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
    /** Coarse block presets for the inspector (ROK-1579). */
    presets?: BlockPresetControl;
    /**
     * GROUP mode (ROK-1580). When set, the day slot shows the poll's aggregate
     * read-only instead of the block editor; `slots`/`onChange` are ignored.
     */
    group?: GroupOverlay;
}

/**
 * The phone week editor, without any of the answers around it (ROK-1569).
 *
 * One day fills the sheet, paged by the header arrows, a horizontal swipe or a
 * tap in the week strip. This component deliberately carries NO actions — no
 * "Same as last week", no absence row, no Save/Skip — so the same editor can be
 * mounted inside the poll's step 1 and anywhere else a week needs editing.
 *
 * TWO MODES. Without `group` it is the EDIT shell of ROK-1569: the viewer's own
 * week, painted with `DayBlockEditor`, seven days that do not wrap. With
 * `group` it is the READ-ONLY poll shell of ROK-1580 — "Find a better time" on
 * a phone: the same chrome, but the day is the group's heatmap, the strip reads
 * the group, the subtitle is the date plus the poll size, and paging past an
 * end asks the caller for the neighbouring week (ROK-1570 re-fetch).
 */
export function PhoneWeekEditorCore({
    slots, onChange, hours, initialDay = 0, onDayChange, dims, inspectorPlacement,
    gridHeader, daySlotRef, presets, group,
}: PhoneWeekEditorCoreProps): JSX.Element {
    const pager = usePhoneWeekEditor(slots, hours, initialDay, onDayChange, group?.onWeekStep);
    const groupKinds = useGroupKinds(group?.cells);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="phone-week-editor">
            <DayPager
                day={pager.day} freeHours={pager.freeHours} subtitle={group?.subtitle}
                canWrap={Boolean(group?.onWeekStep)} onPrev={pager.goPrev} onNext={pager.goNext}
            />
            {gridHeader}
            {/* ROK-1579: a FLOOR of three 44px rows, not `min-h-0`. The day is
                the only flexible child, so an absence panel opening below used
                to squeeze it to zero while its hour labels kept painting over
                the strip. It now bottoms out here and scrolls inside itself. */}
            <div
                ref={daySlotRef} className="min-h-[132px] flex-1" data-testid="phone-day-editor"
                {...pager.swipeHandlers}
            >
                {group ? (
                    <GroupDayView
                        dayOfWeek={pager.day} hours={hours} cells={group.cells}
                        viewerSlots={group.viewerSlots} suggested={group.suggested}
                        onPickHour={(hour) => group.onPickHour(pager.day, hour)}
                    />
                ) : (
                    <DayBlockEditor
                        slots={slots} onChange={onChange} dayOfWeek={pager.day} hours={hours} dims={dims}
                        inspectorPlacement={inspectorPlacement} presets={presets}
                    />
                )}
            </div>
            <WeekStrip
                slots={group ? group.viewerSlots : slots} hours={hours} day={pager.day}
                onPick={pager.setDay} groupKinds={groupKinds}
            />
        </div>
    );
}

/**
 * The week strip's seven days × three bands, read from the group's aggregate.
 *
 * Memoised on the map identity: it is a full pass over 7 × 17 hours, and the
 * strip re-renders on every day step.
 */
function useGroupKinds(cells?: Map<string, HeatmapCellData>): GroupBandKind[][] | undefined {
    return useMemo(() => {
        if (!cells) return undefined;
        return Array.from({ length: 7 }, (_, day) => groupBandShares(cells, day).map(groupBandKind));
    }, [cells]);
}
