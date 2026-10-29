/**
 * ROK-2043 — `useMasonryRows(ref)`: masonry-packs the direct children of a CSS
 * grid (see `masonry-pack.ts`). One ResizeObserver per grid watches every
 * child; its callback (already batched per frame, after layout, before paint)
 * reads every size first, then writes every placement. A MutationObserver
 * hands new children to that observer and re-packs when one is removed.
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

/** Sets `prop` only when it changed — an unchanged placement costs no style invalidation. */
function setIfChanged(el: HTMLElement, prop: string, value: string): void {
    if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/**
 * Reads every child, then writes every placement — one read phase, one write phase.
 * Each cell's inline `grid-column-start` is dropped BEFORE the grid is read: a stale
 * `grid-column-start: 3` left over from lg would keep an implicit third track alive at md,
 * and the computed `grid-template-columns` (which lists implicit tracks) would still say 3.
 */
export function layoutMasonry(grid: HTMLElement): void {
    const cells = Array.from(grid.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    for (const el of cells) el.style.removeProperty('grid-column-start');
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
        setIfChanged(el, 'grid-row-start', String(p.row));
        setIfChanged(el, 'grid-row-end', `span ${p.rowSpan}`);
    });
}

/** Masonry-packs `ref`'s grid children at md+; no-op without ResizeObserver. Cleans up on unmount. */
export function useMasonryRows(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const grid = ref.current;
        if (grid === null || typeof ResizeObserver === 'undefined') return undefined;
        const resize = new ResizeObserver(() => layoutMasonry(grid));
        // Additions only need observing: the RO's initial notification for the new child packs it.
        // A removal resizes nothing that is still observed, so it re-packs here.
        const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
            let removed = false;
            for (const record of records) {
                record.addedNodes.forEach((n) => { if (n instanceof Element) resize.observe(n); });
                record.removedNodes.forEach((n) => { if (n instanceof Element) { resize.unobserve(n); removed = true; } });
            }
            if (removed) layoutMasonry(grid);
        });
        // Children only, never the grid: the grid's own height changes inside the callback. A
        // breakpoint change resizes every child anyway. One "ResizeObserver loop completed with
        // undelivered notifications" can still fire: the first pack grows the page, a classic
        // (non-overlay) scrollbar appears and narrows every column inside the same frame. It
        // settles on the next frame, and Sentry's default inbound filter drops the message.
        for (const child of Array.from(grid.children)) resize.observe(child);
        mutation?.observe(grid, { childList: true });
        return () => {
            resize.disconnect();
            mutation?.disconnect();
            for (const child of Array.from(grid.children)) if (child instanceof HTMLElement) clearPlacement(child);
        };
    }, [ref]);
}
