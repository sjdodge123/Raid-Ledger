/**
 * "Find a better time" on a PHONE (ROK-1580) — approved frame 2 of
 * `planning-artifacts/design-poll-drawer-one-view-2026-09-16.html`.
 *
 * The seven-column heatmap is unreadable at 390px, so below 768px the sheet
 * mounts ROK-1569's phone week editor in GROUP mode instead: one day of the
 * poll aggregate at a time, painted by the SAME `computeHeatmapBg` rule as the
 * desktop grid, the viewer's own saved week outlined on top, and a pager that
 * rolls off the end of the week into the next one (the ROK-1570 re-fetch).
 *
 * Two deliberate absences, both from the approved frame:
 * - the poll's EXISTING slots are not drawn. The desktop grid shows them as
 *   `slotsToPreviewBlocks` "2 votes" chips; on one phone-width day they would
 *   fight the "You" outline and the suggestion for the same 44px row, and the
 *   ladder behind the sheet already lists every slot.
 * - no unknown hatch (operator ruling 2026-09-16) — an hour nobody is known in
 *   simply has no fill, and the legend below says what the fills mean.
 */
import { useMemo, useState, type JSX } from 'react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
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
}

/** The phone's group module — see file-level docstring. */
export function PhoneGroupAvailability(props: PhoneGroupAvailabilityProps): JSX.Element | null {
    const {
        data, isLoading, weekStart, onWeekChange, readOnly, onPickHour, suggested, totalInPoll,
    } = props;
    const cells = useMemo(() => toGroupCellMap(data ? fillUnknownCells(data) : []), [data]);
    const gameTime = useGameTime();
    const viewerSlots = useMemo(() => toTemplateSlots(gameTime.data?.slots ?? []), [gameTime.data]);
    // The day the pager is on, mirrored here for the subtitle's date — and fed
    // back as `initialDay` so a re-fetch (which remounts the editor under the
    // skeleton) resumes on the day the viewer paged to, not on today.
    const [day, setDay] = useState(() => openingDay(weekStart));

    if (isLoading) return <HeatmapSkeleton />;
    if (!data || cells.size === 0) return null;

    const group: GroupOverlay = {
        cells, viewerSlots, suggested,
        // A closed poll still shows the group, but nothing is proposable —
        // no handler, so the cells render as labelled tiles rather than buttons.
        onPickHour: readOnly ? undefined : onPickHour,
        subtitle: subtitleFor(weekStart, day, pollSize(data, totalInPoll)),
        onWeekStep: onWeekChange,
    };
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
function subtitleFor(weekStart: Date, day: number, total: number): string {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + day);
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${label} · ${total} in poll`;
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

/** One legend swatch plus the channel it stands for. */
function LegendKey({ style, label, dashed = false }: {
    style?: React.CSSProperties; label: string; dashed?: boolean;
}): JSX.Element {
    const border = dashed ? 'border-2 border-dashed border-foreground/70' : 'border border-edge';
    return (
        <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`h-3 w-3 rounded-sm ${border}`} style={style} />
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
            <LegendKey style={{ backgroundColor: FREE_SWATCH }} label="free" />
            <LegendKey style={{ backgroundColor: STALE_SWATCH }} label="stale counts half" />
            <LegendKey style={{ backgroundColor: FEW_SWATCH }} label="few" />
            <LegendKey label="you" dashed />
        </div>
    );
}
