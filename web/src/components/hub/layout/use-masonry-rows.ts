/**
 * ROK-2043 — `useMasonryRows(ref)`: masonry-packs the direct children of a CSS
 * grid (see `masonry-pack.ts`). One ResizeObserver per grid watches every
 * child; its callback (already batched per frame, after layout, before paint)
 * reads every size first, then writes every placement. A MutationObserver
 * only hands new children to that observer.
 *
 * The CSS decides when it applies: the grid must resolve to ≥ 2 px column
 * tracks and a px `grid-auto-rows` (the md+ classes in `MASONRY_GRID_CLASS`).
 * A phone's single column, a hidden grid, or an env without ResizeObserver →
 * no inline placement, a plain stack.
 */
import { useEffect, type RefObject } from 'react';
import { packMasonry, type MasonryItem } from './masonry-pack';

/** md+ only: 2px row tracks, no row gap (the gap lives in each span), cells keep their own height. */
export const MASONRY_GRID_CLASS = 'md:auto-rows-[2px] md:gap-y-0 md:items-start';

const PLACEMENT_PROPS = ['grid-column-start', 'grid-row-start', 'grid-row-end'] as const;

interface GridMetrics {
    cols: number;
    gap: number;
    rowUnit: number;
}

/** Resolved column count / column gap / row unit, or null when masonry must not apply. */
function readMetrics(grid: HTMLElement): GridMetrics | null {
    const style = getComputedStyle(grid);
    // `getPropertyValue` always returns a string — jsdom may not model the grid longhands.
    const tracks = style.getPropertyValue('grid-template-columns').trim().split(/\s+/);
    if (tracks.length < 2 || !tracks.every((t) => /^[\d.]+px$/.test(t))) return null;
    const rowUnit = parseFloat(style.getPropertyValue('grid-auto-rows'));
    if (!Number.isFinite(rowUnit) || rowUnit <= 0) return null;
    const gap = parseFloat(style.getPropertyValue('column-gap'));
    return { cols: tracks.length, gap: Number.isFinite(gap) ? gap : 0, rowUnit };
}

function clearPlacement(el: HTMLElement): void {
    for (const prop of PLACEMENT_PROPS) el.style.removeProperty(prop);
}

/** The column span a cell's own classes give it (`span N`), 1 otherwise. */
function measureItem(el: HTMLElement): MasonryItem {
    const match = /span\s+(\d+)/.exec(getComputedStyle(el).getPropertyValue('grid-column-end'));
    return { height: el.getBoundingClientRect().height, span: match?.[1] ? Number(match[1]) : 1 };
}

/** Reads every child, then writes every placement — one read phase, one write phase. */
export function layoutMasonry(grid: HTMLElement): void {
    const cells = Array.from(grid.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    const metrics = readMetrics(grid);
    if (metrics === null) {
        cells.forEach(clearPlacement);
        return;
    }
    const placed = packMasonry(cells.map(measureItem), metrics.cols, metrics.gap, metrics.rowUnit);
    cells.forEach((el, i) => {
        const p = placed[i];
        if (p === undefined) return;
        el.style.setProperty('grid-column-start', String(p.column));
        el.style.setProperty('grid-row-start', String(p.row));
        el.style.setProperty('grid-row-end', `span ${p.rowSpan}`);
    });
}

/** Masonry-packs `ref`'s grid children at md+; no-op without ResizeObserver. Cleans up on unmount. */
export function useMasonryRows(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const grid = ref.current;
        if (grid === null || typeof ResizeObserver === 'undefined') return undefined;
        const resize = new ResizeObserver(() => layoutMasonry(grid));
        const observeChildren = (): void => {
            for (const child of Array.from(grid.children)) resize.observe(child);
        };
        const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
            observeChildren();
            layoutMasonry(grid);
        });
        // Children only, never the grid: the grid's own height changes inside the callback, and a
        // shallower target resized there would raise "ResizeObserver loop completed with undelivered
        // notifications". A breakpoint change resizes every child anyway.
        observeChildren();
        mutation?.observe(grid, { childList: true });
        return () => {
            resize.disconnect();
            mutation?.disconnect();
            for (const child of Array.from(grid.children)) if (child instanceof HTMLElement) clearPlacement(child);
        };
    }, [ref]);
}
