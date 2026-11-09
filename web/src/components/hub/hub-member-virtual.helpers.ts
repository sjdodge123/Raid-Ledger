/**
 * ROK-1173 — the pure half of the windowed Members list. Every band heading
 * and every row has a fixed pixel height, so the list is a run of items with
 * known offsets: from the scroll position and the viewport height we pick the
 * slice to mount (plus overscan) and the spacer heights above and below it.
 */
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';
import type { HubMemberBand } from './hub-members.helpers';

export interface VirtualMetrics {
    /** Height of one member row, px. */
    row: number;
    /** Height of one band heading, px (only labelled bands draw one). */
    heading: number;
}

/** Fixed heights of the desktop table rows / band headings (the shells set them inline). */
export const TABLE_METRICS: VirtualMetrics = { row: 44, heading: 32 };
/**
 * ROK-2155 — a phone card is a fixed stack of lines, so its height is derived:
 * each line is at most a Pill tall (12px text-xs leading 16 + py-0.5 + 1px
 * border = 22), lines are `gap-1` apart, and the card keeps 8px above and below.
 */
export const CARD_LINE = { height: 22, gap: 4, padY: 8 } as const;

/** Height of a phone card with `lines` lines: 2 → 64 (name + meta), 3 → 90 (+ an own line). */
export function cardRowHeight(lines: number): number {
    return 2 * CARD_LINE.padY + lines * CARD_LINE.height + (lines - 1) * CARD_LINE.gap;
}

/** Fixed heights of a two-line phone card / band heading (no `cardLine: 'own'` column). */
export const CARD_METRICS: VirtualMetrics = { row: cardRowHeight(2), heading: 32 };

/** The card metrics for these columns: one more line when any column after the first asks for its own. */
export function cardMetrics(columns: readonly HubMemberColumn[]): VirtualMetrics {
    const ownLine = columns.slice(1).some((c) => c.cardLine === 'own');
    return ownLine ? { ...CARD_METRICS, row: cardRowHeight(3) } : CARD_METRICS;
}

/** The mounted part of one band. */
export interface VisibleBand {
    band: HubMemberBand;
    showHeading: boolean;
    rows: readonly HubMemberRow[];
    /** Index (0-based) of this band's first mounted item in the whole list — headings count (`aria-rowindex`). */
    firstItem: number;
    /** Index (0-based) of the first mounted row within its band (`aria-posinset`). */
    firstRow: number;
}

export interface VirtualSlice {
    bands: readonly VisibleBand[];
    /** Spacer above the first mounted item, px. */
    top: number;
    /** Spacer below the last mounted item, px. */
    bottom: number;
    /** Mounted member rows (headings excluded). */
    mountedRows: number;
    /** Every item in the list, mounted or not — rows plus band headings (`aria-rowcount`). */
    itemCount: number;
}

interface Item { band: number; row: number /* -1 = the heading */; height: number }

function flatten(bands: readonly HubMemberBand[], m: VirtualMetrics): Item[] {
    const items: Item[] = [];
    bands.forEach((band, b) => {
        if (band.label !== '') items.push({ band: b, row: -1, height: m.heading });
        band.rows.forEach((_, r) => items.push({ band: b, row: r, height: m.row }));
    });
    return items;
}

/** First item index whose bottom edge is below `y`. */
function indexAt(items: readonly Item[], y: number): number {
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
        acc += items[i]?.height ?? 0;
        if (acc > y) return i;
    }
    return items.length;
}

function sumHeights(items: readonly Item[], from: number, to: number): number {
    let total = 0;
    for (let i = from; i < to; i++) total += items[i]?.height ?? 0;
    return total;
}

/** Group the mounted items back into their bands, in order. */
function regroup(bands: readonly HubMemberBand[], items: readonly Item[], start: number): VisibleBand[] {
    const out: (VisibleBand & { rows: HubMemberRow[] })[] = [];
    items.forEach((item, i) => {
        const band = bands[item.band];
        if (!band) return;
        let last = out[out.length - 1];
        if (!last || last.band !== band) {
            last = { band, showHeading: false, rows: [], firstItem: start + i, firstRow: Math.max(0, item.row) };
            out.push(last);
        }
        const row = band.rows[item.row];
        if (item.row === -1) last.showHeading = true;
        else if (row) last.rows.push(row);
    });
    return out;
}

/**
 * The slice of `bands` to mount for a viewport of `viewport` px scrolled to
 * `scrollTop`, with `overscan` extra items each side. `scrollTop` past the end
 * (the list just shrank) is clamped, so a narrowed list never renders blank.
 */
export function virtualSlice(
    bands: readonly HubMemberBand[], m: VirtualMetrics, scrollTop: number, viewport: number, overscan: number,
): VirtualSlice {
    const items = flatten(bands, m);
    const total = sumHeights(items, 0, items.length);
    const top = Math.max(0, Math.min(scrollTop, total - viewport));
    const start = Math.max(0, indexAt(items, top) - overscan);
    const end = Math.min(items.length, indexAt(items, top + viewport) + 1 + overscan);
    const mounted = items.slice(start, end);
    return {
        bands: regroup(bands, mounted, start),
        top: sumHeights(items, 0, start),
        bottom: sumHeights(items, end, items.length),
        mountedRows: mounted.filter((i) => i.row !== -1).length,
        itemCount: items.length,
    };
}
