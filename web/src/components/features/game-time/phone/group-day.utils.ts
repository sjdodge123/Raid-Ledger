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

/** Members the group knows about in a cell — free now or free on a stale week. */
function knownShare(cell: HeatmapCellData | undefined): number {
    if (!cell || cell.total <= 0) return 0;
    return (cell.available + (cell.stale ?? 0)) / cell.total;
}

/**
 * How free the group is in each week-strip band on one day, 0..1, in
 * `STRIP_BANDS` order (day / evening / late).
 *
 * The mean is taken over EVERY hour of the band, so an hour the aggregate does
 * not carry counts as nobody free rather than being quietly dropped — a band
 * with one good hour in four must not read as a full band.
 */
export function groupBandShares(
    cells: Map<string, HeatmapCellData>, dayOfWeek: number,
): [number, number, number] {
    const share = (band: StripBand): number => {
        const total = band.hours.reduce(
            (sum, hour) => sum + knownShare(cells.get(groupCellKey(dayOfWeek, hour))), 0,
        );
        return band.hours.length === 0 ? 0 : total / band.hours.length;
    };
    return [share(STRIP_BANDS[0]), share(STRIP_BANDS[1]), share(STRIP_BANDS[2])];
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
    all: 'everyone free',
    most: 'most free',
    few: 'a few free',
    none: 'nobody free',
};

/**
 * Screen-reader label for a group week-strip column — "Wednesday, most free".
 *
 * It reports the BEST band of the day: the strip exists to answer "is this day
 * worth opening", and the best band is the answer.
 */
export function groupStripLabel(dayOfWeek: number, kinds: GroupBandKind[]): string {
    const order: GroupBandKind[] = ['all', 'most', 'few', 'none'];
    const best = order.find((kind) => kinds.includes(kind)) ?? 'none';
    return `${FULL_DAYS[dayOfWeek]}, ${KIND_COPY[best]}`;
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
