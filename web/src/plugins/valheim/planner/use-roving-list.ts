/**
 * ROK-1899 — roving tabindex for the crafting window's recipe list (spec
 * §3.1, AC14): the list is ONE tab stop; Up/Down move focus, Home/End jump to
 * the ends. Focus moves without selecting — the rows are buttons, so Enter and
 * Space select through their native click. Items carry `data-ri="<index>"`;
 * the hook reads them from the event, so it holds no refs.
 */
import { useCallback, useState, type KeyboardEvent } from 'react';

/** The index a key moves to (clamped), or null for a key the list does not own. */
export function nextListIndex(key: string, from: number, count: number): number | null {
    const last = count - 1;
    if (key === 'ArrowDown') return Math.min(last, from + 1);
    if (key === 'ArrowUp') return Math.max(0, from - 1);
    if (key === 'Home') return 0;
    if (key === 'End') return last;
    return null;
}

function indexOf(target: EventTarget): number | null {
    if (!(target instanceof HTMLElement)) return null;
    const raw = target.closest<HTMLElement>('[data-ri]')?.dataset['ri'];
    const n = Number(raw);
    return raw === undefined || Number.isNaN(n) ? null : n;
}

export interface RovingItemProps {
    tabIndex: 0 | -1;
    'data-ri': number;
    onFocus: () => void;
}

export interface RovingList {
    /** Put on the list container. */
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    /** Spread onto item `i`'s focusable element. */
    itemProps: (i: number) => RovingItemProps;
    /** The index holding the tab stop (for memoised rows that build their own props). */
    stop: number;
    /** Stable: record that item `i` took focus. */
    focusIndex: (i: number) => void;
}

/**
 * One tab stop over `count` items. The stop sits on the last focused item,
 * else on `selected` (−1 = none), else on the first.
 */
export function useRovingList(count: number, selected: number): RovingList {
    const [focused, setFocused] = useState<number | null>(null);
    const fallback = selected >= 0 && selected < count ? selected : 0;
    const stop = focused !== null && focused < count ? focused : fallback;
    const onKeyDown = useCallback(
        (e: KeyboardEvent<HTMLElement>) => {
            const from = indexOf(e.target);
            const to = from === null ? null : nextListIndex(e.key, from, count);
            if (to === null) return;
            e.preventDefault();
            e.currentTarget.querySelector<HTMLElement>(`[data-ri="${to}"]`)?.focus();
        },
        [count],
    );
    const itemProps = useCallback(
        (i: number): RovingItemProps => ({ tabIndex: i === stop ? 0 : -1, 'data-ri': i, onFocus: () => setFocused(i) }),
        [stop],
    );
    return { onKeyDown, itemProps, stop, focusIndex: setFocused };
}
