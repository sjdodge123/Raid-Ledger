/**
 * TabRow's overflow split (ROK-1876, tab-row ruling 2026-10-21 option A).
 *
 * The first tabs that fit at the row's measured width stay in the row; the
 * rest go behind a "More ▾" menu. Widths come from an invisible measure layer
 * (`TabRowMeasure`), never a fixed count, so 320 / 375 / 430px and a crowded
 * desktop row all work. When the active tab lands past the fold, the trigger
 * shows its name ("Planner ▾") instead of "More" and the row is re-fitted
 * against that wider trigger. The row never reorders.
 *
 * Kept out of the component files so they export only components
 * (react-refresh/only-export-components).
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** The row's `gap-1`. */
export const TAB_GAP = 4;

export interface TabSplit {
    /** How many of the visible tabs sit in the row; the rest are in More. */
    count: number;
    /** The active tab is in More, so the trigger shows its name. */
    activeHidden: boolean;
}

export interface SplitInput {
    available: number;
    tabWidths: readonly number[];
    moreWidth: number;
    /** Width of the trigger when it shows the active tab's name. */
    activeTriggerWidth: number;
    /** Index of the active tab in `tabWidths`; -1 when none. */
    activeIndex: number;
}

function rowWidth(widths: readonly number[], n: number, gap: number): number {
    return widths.slice(0, n).reduce((a, b) => a + b, 0) + gap * Math.max(0, n - 1);
}

/** All tabs when they fit; else the most leading tabs that fit beside a `triggerWidth` trigger. */
export function fitCount(available: number, widths: readonly number[], triggerWidth: number, gap = TAB_GAP): number {
    if (rowWidth(widths, widths.length, gap) <= available) return widths.length;
    let k = 0;
    for (let i = 1; i <= widths.length; i += 1) {
        if (rowWidth(widths, i, gap) + gap + triggerWidth > available) break;
        k = i;
    }
    return k;
}

export function splitTabs(input: SplitInput): TabSplit {
    const n = input.tabWidths.length;
    // Not laid out yet (or no layout engine): show the plain row.
    if (input.available <= 0) return { count: n, activeHidden: false };
    const k = fitCount(input.available, input.tabWidths, input.moreWidth);
    if (k === n || input.activeIndex < k) return { count: k, activeHidden: false };
    const relabelled = fitCount(input.available, input.tabWidths, input.activeTriggerWidth);
    return { count: Math.min(input.activeIndex, relabelled), activeHidden: true };
}

/** +1px per box absorbs `offsetWidth` rounding, so a "fitting" row never overflows by a pixel. */
function widthOf(measure: HTMLElement, key: string): number {
    return (measure.querySelector<HTMLElement>(`[data-measure="${key}"]`)?.offsetWidth ?? 0) + 1;
}

/** Raw widths for one tab list (`key`); the split itself is derived during render. */
interface Measured {
    key: string;
    available: number;
    tabWidths: number[];
    moreWidth: number;
    /** "<label> ▾" trigger width per tab, in `tabWidths` order. */
    triggerWidths: number[];
}

function readMeasured(nav: HTMLElement, measure: HTMLElement, ids: readonly string[], key: string): Measured {
    return {
        key,
        available: nav.clientWidth,
        tabWidths: ids.map((id) => widthOf(measure, `tab:${id}`)),
        moreWidth: widthOf(measure, 'more'),
        triggerWidths: ids.map((id) => widthOf(measure, `trig:${id}`)),
    };
}

function sameMeasured(a: Measured | null, b: Measured): boolean {
    return a !== null && a.key === b.key && a.available === b.available && a.moreWidth === b.moreWidth
        && a.tabWidths.join() === b.tabWidths.join() && a.triggerWidths.join() === b.triggerWidths.join();
}

/**
 * Measures in a layout effect (before paint), so the first frame is already
 * split; the split is derived during render, so picking a tab from More
 * re-fits in that same render. Re-measures when the row resizes, when the
 * measure layer's row resizes (a web-font swap, a label change) and once
 * `document.fonts` is ready.
 */
export function useTabRowFit(
    navRef: RefObject<HTMLElement | null>,
    measureRef: RefObject<HTMLElement | null>,
    tabs: readonly { id: string; label: string }[],
    activeId: string,
): TabSplit {
    // Labels are in the key: a renamed tab (same id) must re-measure too.
    const key = tabs.map((t) => `${t.id}\t${t.label}`).join('\n');
    const [measured, setMeasured] = useState<Measured | null>(null);
    useLayoutEffect(() => {
        const nav = navRef.current;
        const measure = measureRef.current;
        if (!nav || !measure) return undefined;
        const ids = key ? key.split('\n').map((line) => line.split('\t')[0] ?? '') : [];
        let live = true;
        const run = (): void => {
            if (!live) return;
            const next = readMeasured(nav, measure, ids, key);
            setMeasured((prev) => (sameMeasured(prev, next) ? prev : next));
        };
        run();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run);
        observer?.observe(nav);
        if (measure.firstElementChild) observer?.observe(measure.firstElementChild);
        if ('fonts' in document) void document.fonts.ready.then(run);
        return () => { live = false; observer?.disconnect(); };
    }, [navRef, measureRef, key]);
    // Not measured for this tab list yet: the plain row (the layout effect re-renders before paint).
    if (!measured || measured.key !== key) return { count: tabs.length, activeHidden: false };
    const activeIndex = tabs.findIndex((t) => t.id === activeId);
    return splitTabs({
        available: measured.available,
        tabWidths: measured.tabWidths,
        moreWidth: measured.moreWidth,
        activeTriggerWidth: measured.triggerWidths[activeIndex] ?? measured.moreWidth,
        activeIndex,
    });
}
