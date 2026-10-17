import { useState, useEffect, type RefObject } from 'react';

/**
 * Hook that calculates how many game filter items can fit in the sidebar
 * without causing overflow. Uses ResizeObserver to recalculate on resize.
 *
 * Returns `maxVisible` — the number of items to show inline (minimum 3).
 */

const MINI_CALENDAR_HEIGHT = 260;
const QUICK_ACTIONS_HEIGHT = 120;
const GAPS_AND_PADDING = 48; // gap between sidebar sections + padding
const FILTER_HEADER_HEIGHT = 36;
const FILTER_SECTION_PADDING = 32; // top/bottom padding of .sidebar-section (1rem * 2)
const FILTER_ITEM_HEIGHT = 44; // 28px icon + padding + gap

export function useFilterCap(containerRef: RefObject<HTMLElement | null>): number {
    const [maxVisible, setMaxVisible] = useState(Infinity);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const compute = () => {
            const sidebarHeight = el.clientHeight;
            const spaceForItems =
                sidebarHeight -
                MINI_CALENDAR_HEIGHT -
                QUICK_ACTIONS_HEIGHT -
                GAPS_AND_PADDING -
                FILTER_HEADER_HEIGHT -
                FILTER_SECTION_PADDING;
            const computed = Math.max(3, Math.floor(spaceForItems / FILTER_ITEM_HEIGHT));
            setMaxVisible(computed);
        };

        compute();

        const observer = new ResizeObserver(() => {
            compute();
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, [containerRef]);

    return maxVisible;
}
