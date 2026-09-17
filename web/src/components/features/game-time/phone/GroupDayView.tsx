import { Fragment, type JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { HeatmapCellData } from '../game-time-grid.types';
import { formatHour } from '../game-time-grid.utils';
import { computeHeatmapBg, computeHeatmapLabel } from '../grid-cell.utils';
import { deriveBlocks } from '../slot-blocks.utils';
import { votedLabel, type SlotMark } from '../slot-marks.utils';
import { SlotBlock, YouBar } from './GroupDayMarks';
import {
    blockGeometry, groupCellBusyLabel, groupCellKey, groupCellShortLabel, suggestedBlock,
} from './group-day.utils';

/** Width of the hour gutter — the comp's 52px, same as `DayBlockEditor`. */
const GUTTER = 52;

export interface GroupDayViewProps {
    /** The one day rendered, grid convention (0 = Sunday). */
    dayOfWeek: number;
    hours: number[];
    /** The poll aggregate, keyed by `groupCellKey` (see `toGroupCellMap`). */
    cells: Map<string, HeatmapCellData>;
    /** The viewer's own saved week — a bar on the row's left edge, never a fill. */
    viewerSlots: GameTimeSlot[];
    /** The poll's existing slots for the displayed week, keyed by `groupCellKey` (ROK-1587). */
    slotMarks?: Map<string, SlotMark>;
    /** The hour the viewer last tapped, if it is the one being suggested. */
    suggested?: { dayOfWeek: number; hour: number } | null;
    /** Absent in a read-only poll: cells render as labelled tiles, not 168 inert tab stops. */
    onPickHour?: (hour: number) => void;
}

/**
 * ONE day of the GROUP's availability, read-only (ROK-1580).
 *
 * This is "Find a better time" on a phone: the same aggregate the seven-column
 * heatmap paints, one day at a time, with the count right-aligned inside each
 * cell (operator ruling 2026-09-16), the viewer's own saved week as a solid
 * bar on the row's left edge, and each already-suggested poll slot as a dashed
 * block with "N voted" (ROK-1587) — so "when is everyone free", "when am I
 * free" and "what has been proposed" are legible in one glance.
 *
 * It deliberately does NOT reuse `DayBlockEditor`: nothing here is editable, a
 * tap means "suggest two hours from here" rather than "paint", and the overlay
 * is positioned in PERCENT of the visible hours (equal `1fr` rows) so no
 * measurement pass is needed. It does reuse `computeHeatmapBg` /
 * `computeHeatmapLabel`, because the phone and the desktop must never disagree
 * about what a colour means. The unknown hatch is desktop-only by ruling — an
 * hour nobody is known in simply has no fill.
 */
export function GroupDayView({
    dayOfWeek, hours, cells, viewerSlots, slotMarks, suggested, onPickHour,
}: GroupDayViewProps): JSX.Element {
    return (
        <div
            // `isolate`: the counts' z-10 lifts them over the overlay without
            // escaping this view into the sheet around it (1587-5).
            className="relative isolate min-h-0 flex-1 overflow-y-auto"
            style={{ touchAction: 'pan-y' }}
            data-testid="phone-group-day"
        >
            <div className="relative flex min-h-full flex-col">
                <GroupHourGrid
                    dayOfWeek={dayOfWeek} hours={hours} cells={cells} slotMarks={slotMarks} onPickHour={onPickHour}
                />
                <DayOverlay
                    dayOfWeek={dayOfWeek} hours={hours} viewerSlots={viewerSlots}
                    slotMarks={slotMarks} suggested={suggested}
                />
            </div>
        </div>
    );
}

/**
 * Everything drawn over the cells, bottom → top in DOM order (1587-5): the
 * viewer's bar, the already-suggested slots, then the drafted suggestion.
 */
function DayOverlay({ dayOfWeek, hours, viewerSlots, slotMarks, suggested }: Pick<
    GroupDayViewProps, 'dayOfWeek' | 'hours' | 'viewerSlots' | 'slotMarks' | 'suggested'
>): JSX.Element {
    const youBlocks = deriveBlocks(viewerSlots, dayOfWeek, hours);
    const suggestion = suggested?.dayOfWeek === dayOfWeek ? suggestedBlock(suggested.hour, hours) : null;
    return (
        <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: GUTTER, right: 0 }}
            data-testid="phone-group-overlay"
        >
            {youBlocks.map((block) => <YouBar key={block.startIndex} block={block} hours={hours} />)}
            {marksOnDay(slotMarks, dayOfWeek).map((mark) => <SlotBlock key={mark.hour} mark={mark} hours={hours} />)}
            {suggestion && <SuggestedBlock range={suggestion} hours={hours} />}
        </div>
    );
}

/** The poll slots that start on the displayed day. */
function marksOnDay(slotMarks: Map<string, SlotMark> | undefined, dayOfWeek: number): SlotMark[] {
    return slotMarks ? [...slotMarks.values()].filter((mark) => mark.dayOfWeek === dayOfWeek) : [];
}

/** The hour gutter and the day's group cells — rows stretch, never below 44px. */
function GroupHourGrid({ dayOfWeek, hours, cells, slotMarks, onPickHour }: {
    dayOfWeek: number; hours: number[]; cells: Map<string, HeatmapCellData>;
    slotMarks?: Map<string, SlotMark>; onPickHour?: (hour: number) => void;
}): JSX.Element {
    return (
        <div
            className="grid flex-1 select-none"
            style={{
                gridTemplateColumns: `${GUTTER}px 1fr`,
                gridAutoRows: 'minmax(44px, 1fr)',
                touchAction: 'pan-y',
            }}
        >
            {hours.map((hour) => (
                <Fragment key={hour}>
                    <HourLabel hour={hour} />
                    <GroupCell
                        dayOfWeek={dayOfWeek} hour={hour}
                        cell={cells.get(groupCellKey(dayOfWeek, hour))}
                        votes={slotMarks?.get(groupCellKey(dayOfWeek, hour))?.votes}
                        onPick={onPickHour}
                    />
                </Fragment>
            ))}
        </div>
    );
}

/** The gutter's hour label, matching the editor's 52px column. */
function HourLabel({ hour }: { hour: number }): JSX.Element {
    return (
        <div className="flex items-center justify-end pr-2 text-xs text-dim" data-testid={`phone-group-hour-${hour}`}>
            {formatHour(hour)}
        </div>
    );
}

/**
 * The purple marks a busy cell wears (ROK-1584, design §2) — a 5px left edge.
 *
 * `availableCount` already has these members subtracted (ROK-1570), so without
 * the edge an hour three of four members are signed up in reads "1 free" and
 * looks like a group that never filled in a week.
 */
const BUSY_EDGE = 'before:absolute before:inset-y-0 before:left-0 before:w-[5px] before:bg-busy '
    + 'before:content-[""]';

/**
 * One hour of the group's day.
 *
 * The fill is `computeHeatmapBg`'s rgba — an inline style rather than a class
 * because the alpha encodes the fresh share, which no Tailwind class can carry.
 * The count sits top-right inside the cell; the aria-label carries the full
 * `N free · N stale · N busy · N unknown` copy so nothing is lost to the short form,
 * plus `, N voted` when a poll slot starts in this hour (1587-6).
 */
function GroupCell({ dayOfWeek, hour, cell, votes, onPick }: {
    dayOfWeek: number; hour: number; cell?: HeatmapCellData; votes?: number;
    onPick?: (hour: number) => void;
}): JSX.Element {
    const base = computeHeatmapLabel(cell) ?? 'no data';
    const label = votes === undefined ? base : `${base}, ${votedLabel(votes)}`;
    const style = { background: computeHeatmapBg(cell) };
    const testId = `phone-group-cell-${dayOfWeek}-${hour}`;
    const busy = cell?.busy ?? 0;
    const className = `relative border-t border-edge ${busy > 0 ? BUSY_EDGE : ''}`;
    const shared = {
        'data-testid': testId,
        'data-busy': busy > 0 ? String(busy) : undefined,
        'aria-label': label,
        style,
    };
    const count = <GroupCellCount cell={cell} />;
    // A closed poll (review 2a): the count is still information, but a button
    // that does nothing is 168 tab stops of noise — so it is an image instead.
    if (!onPick) {
        return <div role="img" {...shared} className={className}>{count}</div>;
    }
    return (
        <button type="button" {...shared} onClick={() => onPick(hour)} className={`${className} text-right`}>
            {count}
        </button>
    );
}

/** The right-aligned count — free/stale in the foreground, busy in purple. */
function GroupCellCount({ cell }: { cell?: HeatmapCellData }): JSX.Element {
    const busyLabel = groupCellBusyLabel(cell);
    return (
        <span className="absolute right-1.5 top-1 z-10 text-[11px] leading-none text-foreground/80">
            {groupCellShortLabel(cell)}
            {busyLabel && <b className="font-medium text-busy">{busyLabel}</b>}
        </span>
    );
}

/** The two hours a tap proposes — solid, because it is the answer being drafted. */
function SuggestedBlock({ range, hours }: {
    range: { startIndex: number; endIndex: number }; hours: number[];
}): JSX.Element {
    const span = range.endIndex - range.startIndex;
    return (
        <div
            data-testid="phone-group-suggested-block"
            // ROK-1580 operator plan (step 2): a suggestion usually lands INSIDE the
            // viewer's own block, and both labels sat in the top-left corner and
            // overprinted ("2hu Suggested 7 PM"). The suggestion now labels its
            // BOTTOM-left; "You" keeps the top-left, the counts keep the right.
            className="absolute inset-x-1 flex items-end rounded-md border border-emerald-500 bg-emerald-500/25 px-1.5 py-0.5"
            style={blockGeometry(range.startIndex, range.endIndex, hours.length)}
        >
            <span className="text-[11px] font-semibold leading-none text-foreground">
                {`${span}h · Suggested ${formatHour(hours[range.startIndex])}`}
            </span>
        </div>
    );
}
