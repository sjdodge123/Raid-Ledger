/**
 * "Find a better time" on a PHONE (ROK-1580) — approved frame 2 of
 * `planning-artifacts/design-poll-drawer-one-view-2026-09-16.html`.
 *
 * The seven-column heatmap is unreadable at 390px, so below 768px the sheet
 * mounts ROK-1569's phone week editor in GROUP mode instead: one day of the
 * poll aggregate at a time, painted by the SAME `computeHeatmapBg` rule as the
 * desktop week view, and a pager that rolls off the end of the week into the
 * next one (the ROK-1570 re-fetch).
 *
 * ROK-1587 (approved board P-a) added the marks: the viewer's own saved week is
 * a solid bar on each row's left edge, and the poll's EXISTING slots (`slotMarks`,
 * computed once by the caller with `slotMarksForWeek`) are dashed blocks with
 * "N voted" on their start hour, counted as "● N" in the week strip. They are
 * read-only — voting stays on the ladder behind the sheet.
 *
 * The same module is Reschedule's phone body (ROK-1588 Q5), which is why the
 * subtitle's noun is a prop: "4 in poll" here, "4 signed up" there.
 *
 * No unknown hatch (operator ruling 2026-09-16) — an hour nobody is known in
 * simply has no fill, and the legend below says what the fills mean.
 */
import { useMemo, useState, type JSX } from 'react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import type { SlotMark } from '../../features/game-time/slot-marks.utils';
import { useGameTime } from '../../../hooks/use-game-time';
import { HeatmapSkeleton } from '../../../pages/scheduling/AvailabilityHeatmapSection';
import { ViewerStaleHint } from '../../../pages/scheduling/AvailabilityHeatmapLegend';
import { fillUnknownCells, isViewerStale } from '../../../pages/scheduling/availability-freshness';
import { computeHeatmapBg } from '../../features/game-time/grid-cell.utils';
import {
    PhoneWeekEditorCore,
    type GroupOverlay,
} from '../../features/game-time/phone/PhoneWeekEditorCore';
import { toGroupCellMap } from '../../features/game-time/phone/group-day.utils';
import {
    CHECK_HOURS,
    toTemplateSlots,
} from '../../features/game-time/phone/phone-week-check.helpers';
import { getWeekStart } from './scheduling-availability';

export interface PhoneGroupAvailabilityProps {
    data: AggregateGameTimeResponse | undefined;
    isLoading: boolean;
    /** The Sunday the displayed week starts on — the query is scoped to it. */
    weekStart: Date;
    /** Paging off an end of the week; the caller re-queries (ROK-1570). */
    onWeekChange: (delta: number) => void;
    /** A closed/terminal poll still shows the group, but nothing is proposable. */
    readOnly: boolean;
    onPickHour: (dayOfWeek: number, hour: number) => void;
    /** The hour the viewer last tapped, drawn as a two-hour block. */
    suggested?: { dayOfWeek: number; hour: number } | null;
    /** Overrides the poll size the subtitle reads off `data`. */
    totalInPoll?: number;
    /** The poll's slots in the displayed week, keyed by `groupCellKey` (ROK-1587). */
    slotMarks?: Map<string, SlotMark>;
    /** What the subtitle calls the group after its size — default "in poll" ("4 in poll"). */
    sizeNoun?: string;
}

/** The phone's group module — see file-level docstring. */
export function PhoneGroupAvailability(props: PhoneGroupAvailabilityProps): JSX.Element | null {
    const { data, isLoading, weekStart } = props;
    const cells = useMemo(() => toGroupCellMap(data ? fillUnknownCells(data) : []), [data]);
    const gameTime = useGameTime();
    const viewerSlots = useMemo(() => toTemplateSlots(gameTime.data?.slots ?? []), [gameTime.data]);
    // The day the pager is on, mirrored here for the subtitle's date — and fed
    // back as `initialDay` so a re-fetch (which remounts the editor under the
    // skeleton) resumes on the day the viewer paged to, not on today.
    const [day, setDay] = useState(() => openingDay(weekStart));

    if (isLoading) return <HeatmapSkeleton />;
    if (!data || cells.size === 0) return null;

    const group = overlayFor(props, data, { cells, viewerSlots, day });
    return (
        <div className="flex h-full min-h-0 flex-col gap-2" data-testid="phone-group-availability">
            <div className="min-h-0 flex-1">
                <PhoneWeekEditorCore
                    slots={[]} hours={CHECK_HOURS} initialDay={day} onDayChange={setDay}
                    group={group}
                />
            </div>
            {/* The stale/unknown channels only exist on the poll aggregate (ROK-1560);
                an events-style aggregate has no freshness model and no legend (review 2b). */}
            {data.freshnessDays !== undefined && <GroupLegend />}
            {viewerIsStale(data) && <ViewerStaleHint />}
        </div>
    );
}

/** The editor's group overlay: the aggregate, the marks, and what a tap does. */
function overlayFor(
    props: PhoneGroupAvailabilityProps,
    data: AggregateGameTimeResponse,
    view: Pick<GroupOverlay, 'cells' | 'viewerSlots'> & { day: number },
): GroupOverlay {
    const { readOnly, onPickHour, onWeekChange, weekStart, totalInPoll, sizeNoun = 'in poll' } = props;
    return {
        cells: view.cells, viewerSlots: view.viewerSlots,
        suggested: props.suggested, slotMarks: props.slotMarks,
        // A closed poll still shows the group, but nothing is proposable —
        // no handler, so the cells render as labelled tiles rather than buttons.
        onPickHour: readOnly ? undefined : onPickHour,
        subtitle: subtitleFor(weekStart, view.day, `${pollSize(data, totalInPoll)} ${sizeNoun}`),
        onWeekStep: onWeekChange,
    };
}

/**
 * The day the module opens on: TODAY when the poll is showing this week, and
 * Sunday for any other week — paging into next week should land at its start,
 * not on the weekday the viewer happened to open the sheet on.
 */
function openingDay(weekStart: Date): number {
    const now = new Date();
    const sameWeek = getWeekStart(now).getTime() === getWeekStart(weekStart).getTime();
    return sameWeek ? now.getDay() : 0;
}

/** "Sep 16 · 4 in poll" — the date on screen plus who it is being asked of. */
function subtitleFor(weekStart: Date, day: number, size: string): string {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + day);
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${label} · ${size}`;
}

/** Poll members, falling back to the plain user count for legacy aggregates. */
function pollSize(data: AggregateGameTimeResponse, override?: number): number {
    return override ?? data.totalMembers ?? data.totalUsers;
}

/** Whether the viewer's own game time is too old to count toward the fill. */
function viewerIsStale(data: AggregateGameTimeResponse): boolean {
    if (data.freshnessDays === undefined) return false;
    return isViewerStale(data.viewerGameTimeAgeDays, data.freshnessDays, data.viewerGameTimeStale);
}

// Swatches come from the painter itself, so the legend cannot drift from the
// cells — the same trick `AvailabilityHeatmapLegend` uses on the desktop.
const FREE_SWATCH = computeHeatmapBg({ available: 1, total: 1, stale: 0, unknown: 0 });
const STALE_SWATCH = computeHeatmapBg({ available: 0, total: 1, stale: 1, unknown: 0 });
const FEW_SWATCH = computeHeatmapBg({ available: 1, total: 4, stale: 0, unknown: 0 });

/** A fill swatch: 12px, edged, painted by `computeHeatmapBg`. */
const FILL_SWATCH = 'h-3 w-3 rounded-sm border border-edge';
/** The you-bar in miniature — the same 4px solid `foreground/70` as the day's bar. */
const YOU_SWATCH = 'h-3 w-1 rounded-sm bg-foreground/70';
/** A slot block in miniature — the same dashed `--color-slot` border and soft fill. */
const SLOT_SWATCH = 'h-3 w-3 rounded-sm border-2 border-dashed border-slot bg-slot/10';

/** One legend swatch plus the channel it stands for. */
function LegendKey({ swatch, style, label, testId }: {
    swatch: string; style?: React.CSSProperties; label: string; testId?: string;
}): JSX.Element {
    return (
        <span className="inline-flex items-center gap-1" data-testid={testId}>
            <span aria-hidden="true" className={swatch} style={style} />
            <span>{label}</span>
        </span>
    );
}

/**
 * What the fills mean, in one line (frame 2). It replaces the desktop's prose
 * intro: on a phone the sheet has no room for a paragraph, and the legend is
 * the part that is actually load-bearing once the counts are inside the cells.
 */
function GroupLegend(): JSX.Element {
    return (
        <div
            data-testid="phone-group-legend"
            className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted"
        >
            <LegendKey swatch={FILL_SWATCH} style={{ backgroundColor: FREE_SWATCH }} label="free" />
            <LegendKey swatch={FILL_SWATCH} style={{ backgroundColor: STALE_SWATCH }} label="stale counts half" />
            <LegendKey swatch={FILL_SWATCH} style={{ backgroundColor: FEW_SWATCH }} label="few" />
            <LegendKey swatch={YOU_SWATCH} label="You" testId="phone-group-legend-you" />
            {/* Always shown, slots or not, so the legend keeps its height (Q7). */}
            <LegendKey swatch={SLOT_SWATCH} label="Already suggested" testId="phone-group-legend-slot" />
        </div>
    );
}
