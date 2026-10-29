/**
 * ROK-2043 — masonry pack maths for the hub Overview bento (pure, no DOM).
 *
 * The grid runs on tiny fixed row tracks (`grid-auto-rows: <rowUnit>px`, no
 * row gap). Every card keeps the column its arranged order gives it in a plain
 * row-by-row layout, keeps its column span, and starts on the first track
 * below the card(s) above it — so a short card no longer leaves a hole the
 * height of its tallest row-mate. The visual gap is reserved inside each
 * card's row span.
 */

/** One grid cell as measured: its rendered height (px) and its column span. */
export interface MasonryItem {
    height: number;
    span: number;
}

/** Explicit 1-based grid lines for one cell. */
export interface MasonryPlacement {
    column: number;
    row: number;
    rowSpan: number;
}

/** Tolerance so float noise in a measured height never costs a whole extra track. */
const EPSILON = 1e-3;

/**
 * Row tracks a card of `height` px needs on a `rowUnit` px track grid with no
 * row gap, reserving `gap` px below it: ceil((height + gap) / rowUnit).
 * Returns 0 for an empty cell (or a non-positive / non-finite input).
 */
export function masonryRowSpan(height: number, gap: number, rowUnit: number): number {
    if (!(height > 0) || !(rowUnit > 0) || !Number.isFinite(height)) return 0;
    return Math.ceil((height + gap) / rowUnit - EPSILON);
}

/**
 * Places `items` (in arranged order) on a `cols`-column track grid. The column
 * comes from a plain row-flow walk (a span that does not fit the rest of the
 * row wraps to column 1); the row is the lowest bottom among its columns.
 * An empty cell takes no slot and no height (one track, overlapped).
 */
export function packMasonry(items: readonly MasonryItem[], cols: number, gap: number, rowUnit: number): MasonryPlacement[] {
    const bottoms: number[] = new Array<number>(Math.max(cols, 1)).fill(0);
    let cursor = 0;
    return items.map((item) => {
        const span = Math.min(Math.max(Math.floor(item.span), 1), bottoms.length);
        if (cursor + span > bottoms.length) cursor = 0;
        const column = cursor;
        const covered = bottoms.slice(column, column + span);
        const row = Math.max(...covered);
        const rowSpan = masonryRowSpan(item.height, gap, rowUnit);
        if (rowSpan === 0) return { column: column + 1, row: row + 1, rowSpan: 1 };
        bottoms.fill(row + rowSpan, column, column + span);
        cursor = (column + span) % bottoms.length;
        return { column: column + 1, row: row + 1, rowSpan };
    });
}
