/**
 * ROK-2187 — whether an element's content is taller than its box. Re-measured
 * when the element or any direct child resizes (e.g. the share image loads).
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** True while `ref`'s content overflows it vertically. */
export function useOverflows(ref: RefObject<HTMLElement | null>): boolean {
    const [overflows, setOverflows] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = (): void => setOverflows(el.scrollHeight > el.clientHeight + 1);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        Array.from(el.children).forEach((child) => ro.observe(child));
        return () => ro.disconnect();
    }, [ref]);
    return overflows;
}
