import { Fragment, useMemo, type JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { MemberCounts } from '../../../../pages/scheduling/availability-freshness';
import type { HeatmapCellData } from '../game-time-grid.types';
import { DAYS, formatHour } from '../game-time-grid.utils';
import { isSlotActive } from '../game-time-slot.utils';
import { groupCellKey } from '../phone/group-day.utils';
import type { SlotMark } from '../slot-marks.utils';
import { GroupWeekCell } from './GroupWeekCell';
import { GroupWeekLegend } from './GroupWeekLegend';
import { GroupWeekToolbar } from './GroupWeekToolbar';
import { useWeekHours } from './use-week-hours';
import { moveWeekFocus } from './week-keyboard';
import { dayHeaderDate, isToday } from './week-label';

/** A (day, hour) cell reference. */
export interface WeekCellRef {
    dayOfWeek: number;
    hour: number;
}

export interface GroupWeekViewProps {
    /** Sunday 00:00 local of the displayed week. */
    weekStart: Date;
    /** The aggregate keyed by `groupCellKey` — `toGroupCellMap(fillUnknownCells(data))`. */
    cells: Map<string, HeatmapCellData>;
    /** The viewer's template slots → dashed "your game time" cells. */
    viewerSlots: GameTimeSlot[];
    /** Poll slots starting in this week (`slotMarksForWeek`); poll only. */
    slotMarks?: Map<string, SlotMark>;
    picked?: WeekCellRef | null;
    /** Reschedule: the event's current start. */
    current?: WeekCellRef | null;
    isCellDisabled?: (dayOfWeek: number, hour: number) => boolean;
    /** Absent = read-only: cells are `role="img"` tiles. */
    onPick?: (dayOfWeek: number, hour: number) => void;
    onWeekChange: (delta: -1 | 1) => void;
    legend: { memberCounts?: MemberCounts };
    /** Default `group-week-view`. */
    testId?: string;
}

const COLUMNS = { gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' };
const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

const sameCell = (ref: WeekCellRef | null | undefined, day: number, hour: number): boolean =>
    ref?.dayOfWeek === day && ref.hour === hour;

/** Hours that must be visible: every slot mark, the pick and the current start. */
function requiredHours(props: GroupWeekViewProps): WeekCellRef[] {
    const required: WeekCellRef[] = [...(props.slotMarks?.values() ?? [])];
    if (props.picked) required.push(props.picked);
    if (props.current) required.push(props.current);
    return required;
}

/** `groupCellKey`s of the hours the viewer's template marks available. */
function viewerHourKeys(slots: GameTimeSlot[]): Set<string> {
    return new Set(slots.filter(isSlotActive).map((s) => groupCellKey(s.dayOfWeek, s.hour)));
}

/** Blank gutter corner + "Sun / Sep 20" × 7; today's column in the accent. */
function HeaderRow({ weekStart }: { weekStart: Date }): JSX.Element {
    return (
        <>
            <div className="h-11 border-b border-edge-subtle" />
            {DAY_INDEXES.map((d) => (
                <div key={d} data-testid={`group-week-header-${d}`}
                    className={`flex h-11 flex-col items-center justify-center border-b border-edge-subtle text-xs ${
                        isToday(weekStart, d) ? 'text-accent' : 'text-muted'}`}>
                    <b className={`text-[13px] ${isToday(weekStart, d) ? '' : 'text-foreground'}`}>{DAYS[d]}</b>
                    {dayHeaderDate(weekStart, d)}
                </div>
            ))}
        </>
    );
}

/** One hour: its gutter label and seven cells. */
function HourRow({ hour, props, youKeys }: {
    hour: number; props: GroupWeekViewProps; youKeys: Set<string>;
}): JSX.Element {
    return (
        <>
            <div className="flex h-10 items-center justify-end pr-2 text-[11px] text-dim">{formatHour(hour)}</div>
            {DAY_INDEXES.map((d) => (
                <GroupWeekCell key={d} dayOfWeek={d} hour={hour} cell={props.cells.get(groupCellKey(d, hour))}
                    you={youKeys.has(groupCellKey(d, hour))} votes={props.slotMarks?.get(groupCellKey(d, hour))?.votes}
                    picked={sameCell(props.picked, d, hour)} current={sameCell(props.current, d, hour)}
                    disabled={props.isCellDisabled?.(d, hour) ?? false} onPick={props.onPick} />
            ))}
        </>
    );
}

/**
 * The group's week as seven day columns × hour rows (ROK-1588 D-b) — desktop
 * "Find a better time" and Reschedule. Counts, fill, busy edge, your game time,
 * already-suggested slots and the pick are all per-cell marks.
 */
export function GroupWeekView(props: GroupWeekViewProps): JSX.Element {
    const { weekStart, viewerSlots, onWeekChange, legend, testId = 'group-week-view' } = props;
    const { hours, earlier, later } = useWeekHours(requiredHours(props));
    const youKeys = useMemo(() => viewerHourKeys(viewerSlots), [viewerSlots]);
    return (
        <div data-testid={testId} className="flex flex-col gap-3.5">
            <GroupWeekToolbar weekStart={weekStart} onWeekChange={onWeekChange} earlier={earlier} later={later} />
            <div data-testid="group-week-grid" className="grid" style={COLUMNS}
                onKeyDown={(e) => moveWeekFocus(e, hours)}>
                <HeaderRow weekStart={weekStart} />
                {hours.map((hour) => (
                    <Fragment key={hour}><HourRow hour={hour} props={props} youKeys={youKeys} /></Fragment>
                ))}
            </div>
            <GroupWeekLegend memberCounts={legend.memberCounts} />
        </div>
    );
}
