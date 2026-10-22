/** ROK-1868 D6 — true when a height-clamped element's content overflows it (ResizeObserver-tracked). */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** The root font size in px (what `rem` resolves to); 16 when unreadable. */
function remPx(): number {
    const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * Whether the element's content is taller than its clamp.
 * @param ref - the clamped element
 * @param deps - re-measure when these change
 * @param clampRem - measure against this fixed clamp height (rem) instead of the
 *   element's own height, so the answer holds while the clamp is lifted (expanded)
 * @returns true when the content would overflow the clamp
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = [], clampRem?: number): boolean {
    const [overflowing, setOverflowing] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = (): void => {
            const limit = clampRem === undefined ? el.clientHeight : clampRem * remPx();
            setOverflowing(el.scrollHeight > limit + 1);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ref, clampRem, ...deps]);
    return overflowing;
}
