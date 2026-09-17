import type { AggregateGameTimeCell } from '@raid-ledger/contract';
import type { HeatmapCellData } from '../game-time-grid.types';
import { FULL_DAYS } from '../game-time-grid.utils';
import { STRIP_BANDS, type StripBand } from './phone-week.utils';

/**
 * Pure helpers for the phone's GROUP day view (ROK-1580).
 *
 * "Find a better time" shows the same aggregate as the seven-column heatmap,
 * one day at a time. Everything here is a reduction of that aggregate — the
 * paint itself still comes from `grid-cell.utils.ts`, so the phone and the
 * desktop can never disagree about what a colour means.
 */

/** Lookup key for one aggregate cell — the same shape `buildHeatmapMap` uses. */
export function groupCellKey(dayOfWeek: number, hour: number): string {
    return `${dayOfWeek}:${hour}`;
}

/**
 * Index the poll aggregate by day/hour, in the shape the heatmap helpers eat.
 *
 * `stale` / `unknown` are passed through as-is, including `undefined`: their
 * absence is what tells `computeHeatmapBg` it is looking at a legacy aggregate
 * with no freshness model, and defaulting them to 0 would silently change the
 * colour ramp.
 */
export function toGroupCellMap(cells: AggregateGameTimeCell[]): Map<string, HeatmapCellData> {
    const map = new Map<string, HeatmapCellData>();
    for (const cell of cells) {
        map.set(groupCellKey(cell.dayOfWeek, cell.hour), {
            available: cell.availableCount,
            total: cell.totalCount,
            stale: cell.staleCount,
            unknown: cell.unknownCount,
            busy: cell.busyCount,
        });
    }
    return map;
}

/**
 * The count that sits right-aligned inside a cell — "4 free", "3 free · 1
 * stale", "0 free" (operator ruling 2026-09-16: counts on the right).
 *
 * Deliberately shorter than `computeHeatmapLabel`: the unknown count is the
 * aria-label's job, because a phone cell is 44px tall and a third clause makes
 * the row unreadable.
 */
export function groupCellShortLabel(cell?: HeatmapCellData): string {
    if (!cell) return '';
    const stale = cell.stale ?? 0;
    return stale > 0 ? `${cell.available} free · ${stale} stale` : `${cell.available} free`;
}

/**
 * The busy clause of a cell's label — `' · 2 busy'`, or `''` when nobody is.
 *
 * Separate from `groupCellShortLabel` because the design (§2) paints only this
 * clause in the busy colour: "2 free" stays foreground, "· 2 busy" is purple.
 * Rendered next to the short label, the cell still reads `2 free · 2 busy`.
 */
export function groupCellBusyLabel(cell?: HeatmapCellData): string {
    const busy = cell?.busy ?? 0;
    return busy > 0 ? ` · ${busy} busy` : '';
}

/** Members the group knows about in a cell — free now or free on a stale week. */
function knownShare(cell: HeatmapCellData | undefined): number {
    if (!cell || cell.total <= 0) return 0;
    return (cell.available + (cell.stale ?? 0)) / cell.total;
}

/**
 * What one band of one day says about the group (ROK-1584).
 *
 * `best` is the band's best hour, `other` the worst hour that reads as a
 * DIFFERENT kind (null when the band is of one mind), and `busy` whether any
 * hour of it has someone committed elsewhere.
 */
export interface GroupBandShare {
    best: number;
    other: number | null;
    busy: boolean;
}

/** The known shares of a band's hours, skipping hours the aggregate has nothing for. */
function bandHourShares(
    cells: Map<string, HeatmapCellData>, dayOfWeek: number, band: StripBand,
): number[] {
    return band.hours
        .map((hour) => cells.get(groupCellKey(dayOfWeek, hour)))
        .filter((cell): cell is HeatmapCellData => Boolean(cell) && (cell as HeatmapCellData).total > 0)
        .map(knownShare);
}

/** One band's two tones and its busy flag. */
function bandShare(
    cells: Map<string, HeatmapCellData>, dayOfWeek: number, band: StripBand,
): GroupBandShare {
    const shares = bandHourShares(cells, dayOfWeek, band);
    const best = shares.reduce((top, share) => Math.max(top, share), 0);
    const bestKind = groupBandKind(best);
    const differing = shares.filter((share) => groupBandKind(share) !== bestKind);
    const busy = band.hours.some(
        (hour) => (cells.get(groupCellKey(dayOfWeek, hour))?.busy ?? 0) > 0,
    );
    return { best, other: differing.length ? Math.min(...differing) : null, busy };
}

/**
 * How free the group is in each week-strip band on one day, in `STRIP_BANDS`
 * order (day / evening / late).
 *
 * Each band reports its BEST hour. The strip is a day picker — its question is
 * "is there a good hour in this band?", and the answer has to agree with the
 * cells the viewer sees after tapping. The first cut averaged every hour of the
 * band, so a Wednesday whose 8–9 PM cells painted amber ("most") wore a red
 * ("few") bar because 5 PM and 10 PM were empty (operator plan, 2026-09-16).
 *
 * ROK-1584 added the second tone: reporting the best hour alone hid an evening
 * that is amber at 8 PM and red at 10 PM behind one amber bar, so the band also
 * reports its WORST differing hour and the bar paints both.
 */
export function groupBandShares(
    cells: Map<string, HeatmapCellData>, dayOfWeek: number,
): [GroupBandShare, GroupBandShare, GroupBandShare] {
    return [
        bandShare(cells, dayOfWeek, STRIP_BANDS[0]),
        bandShare(cells, dayOfWeek, STRIP_BANDS[1]),
        bandShare(cells, dayOfWeek, STRIP_BANDS[2]),
    ];
}

/** What one band's bar says about the GROUP, as opposed to the viewer. */
export type GroupBandKind = 'all' | 'most' | 'few' | 'none';

/**
 * A band reads as everyone / most / a few / nobody.
 *
 * The thresholds mirror `computeHeatmapBg` (≥ 1 green, > 0.5 amber, else red)
 * so the strip and the cells under it tell the same story.
 */
export function groupBandKind(share: number): GroupBandKind {
    if (share >= 0.999) return 'all';
    if (share > 0.5) return 'most';
    return share > 0 ? 'few' : 'none';
}

/** Spoken form of a band kind, for the strip's screen-reader label. */
const KIND_COPY: Record<GroupBandKind, string> = {
    all: 'everyone',
    most: 'most',
    few: 'a few',
    none: 'nobody',
};

/** Spoken form of a band, which its id ('day' / 'late') is too terse to be. */
const BAND_COPY: Record<string, string> = {
    day: 'daytime',
    evening: 'evening',
    late: 'late night',
};

/** Rank order for "which band of this day is worth reporting". */
const KIND_RANK: GroupBandKind[] = ['all', 'most', 'few', 'none'];

/** The band a day should be judged by: the one whose best hour reads highest. */
function bestBandIndex(bands: GroupBandShare[]): number {
    const kinds = bands.map((band) => groupBandKind(band.best));
    const winner = KIND_RANK.find((kind) => kinds.includes(kind)) ?? 'none';
    return Math.max(0, kinds.indexOf(winner));
}

/**
 * Screen-reader label for a group week-strip column — "Wednesday, evening:
 * most to a few free, busy".
 *
 * It reports the BEST band of the day: the strip exists to answer "is this day
 * worth opening", and the best band is the answer. Both of the things the bar
 * draws are spoken — the second tone (ROK-1584) and the purple cap, the latter
 * for the whole day, because a busy hour anywhere is a reason to look.
 */
export function groupStripLabel(dayOfWeek: number, bands: GroupBandShare[]): string {
    const day = FULL_DAYS[dayOfWeek];
    if (!bands.length) return `${day}, nobody free`;
    const index = bestBandIndex(bands);
    const band = bands[index];
    const kind = groupBandKind(band.best);
    const busy = bands.some((b) => b.busy) ? ', busy' : '';
    // A day nobody is known free on has no band worth naming.
    if (kind === 'none') return `${day}, nobody free${busy}`;
    const other = band.other === null ? '' : ` to ${KIND_COPY[groupBandKind(band.other)]}`;
    const where = BAND_COPY[STRIP_BANDS[index].id] ?? STRIP_BANDS[index].id;
    return `${day}, ${where}: ${KIND_COPY[kind]}${other} free${busy}`;
}

/**
 * The two-hour block a tapped hour suggests, in visible-hour index space.
 *
 * Clamped to the end of the visible range rather than spilling past it — the
 * block layer is drawn as a percentage of the visible hours, so an index past
 * the end would paint outside the day. `null` when the hour is not on screen.
 */
export function suggestedBlock(
    hour: number, hours: number[],
): { startIndex: number; endIndex: number } | null {
    const startIndex = hours.indexOf(hour);
    if (startIndex < 0) return null;
    return { startIndex, endIndex: Math.min(startIndex + 2, hours.length) };
}

/** A run of visible-hour indices, end exclusive. */
export interface HourRange {
    startIndex: number;
    endIndex: number;
}

/** Top/height of a block as a percentage of the visible hours. */
export function blockGeometry(startIndex: number, endIndex: number, length: number): {
    top: string; height: string;
} {
    return {
        top: `${(startIndex / length) * 100}%`,
        height: `${((endIndex - startIndex) / length) * 100}%`,
    };
}
