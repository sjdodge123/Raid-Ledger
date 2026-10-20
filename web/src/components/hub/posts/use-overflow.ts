/** ROK-1868 D6 — true when a height-clamped element's content overflows it (ResizeObserver-tracked). */
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useOverflow(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): boolean {
    const [overflowing, setOverflowing] = useState(false);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = (): void => setOverflowing(el.scrollHeight > el.clientHeight);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ref, ...deps]);
    return overflowing;
}
