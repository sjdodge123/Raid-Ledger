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

function measureSplit(nav: HTMLElement, measure: HTMLElement, ids: readonly string[], activeId: string): TabSplit {
    return splitTabs({
        available: nav.clientWidth,
        tabWidths: ids.map((id) => widthOf(measure, `tab:${id}`)),
        moreWidth: widthOf(measure, 'more'),
        activeTriggerWidth: widthOf(measure, `trig:${activeId}`),
        activeIndex: ids.indexOf(activeId),
    });
}

/**
 * Re-measures whenever the row resizes, the tabs change or the active tab
 * changes. ResizeObserver reports once on `observe` (between layout and
 * paint), so the first frame is already split — no flash of a clipped row.
 */
export function useTabRowFit(
    navRef: RefObject<HTMLElement | null>,
    measureRef: RefObject<HTMLElement | null>,
    ids: readonly string[],
    activeId: string,
): TabSplit {
    const key = ids.join('\n');
    // Tagged with the tab list it was measured for, so a list that grows (a plugin's tabs
    // hydrating) shows every tab until the observer re-measures — never a stale count.
    const [split, setSplit] = useState<TabSplit & { key: string }>({ key, count: ids.length, activeHidden: false });
    useLayoutEffect(() => {
        const nav = navRef.current;
        const measure = measureRef.current;
        if (!nav || !measure || typeof ResizeObserver === 'undefined') return undefined;
        const tabIds = key ? key.split('\n') : [];
        const observer = new ResizeObserver(() => {
            const next = measureSplit(nav, measure, tabIds, activeId);
            setSplit((prev) => (prev.key === key && prev.count === next.count && prev.activeHidden === next.activeHidden
                ? prev : { key, ...next }));
        });
        observer.observe(nav);
        return () => observer.disconnect();
    }, [navRef, measureRef, key, activeId]);
    if (split.key !== key) return { count: ids.length, activeHidden: false };
    return { count: split.count, activeHidden: split.activeHidden };
}
