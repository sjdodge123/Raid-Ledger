/**
 * Paging state + input wiring for `StoryViewer` (ROK-2187): the current index
 * clamped to the deck, ←/→ on the window, and horizontal swipe on the stage.
 * Escape is NOT here — the viewer registers it through `useEscapeLayer` so a
 * sheet opened above it closes first.
 */
import { useCallback, useEffect, useRef, useState, type RefObject, type TouchEvent } from 'react';

/** A horizontal drag shorter than this (px) is a tap, not a swipe. */
export const SWIPE_MIN_PX = 40;

export interface StoryNavigation {
    index: number;
    atStart: boolean;
    atEnd: boolean;
    next: () => void;
    prev: () => void;
    onTouchStart: (e: TouchEvent) => void;
    onTouchEnd: (e: TouchEvent) => void;
}

/** Clamp `i` into `[0, count - 1]` (0 for an empty deck). */
export function clampIndex(i: number, count: number): number {
    return Math.max(0, Math.min(Math.max(0, count - 1), Math.trunc(i)));
}

function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** True when the key event belongs to another modal layered over (or beside) `container`. */
function belongsToOtherModal(target: EventTarget | null, container: HTMLElement | null): boolean {
    if (!(target instanceof Element)) return false;
    const owner = target.closest('[aria-modal="true"]');
    return owner !== null && owner !== container;
}

function useArrowKeys(containerRef: RefObject<HTMLElement | null>, next: () => void, prev: () => void): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            if (e.defaultPrevented || isEditable(e.target) || belongsToOtherModal(e.target, containerRef.current)) return;
            e.preventDefault();
            if (e.key === 'ArrowRight') next(); else prev();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [containerRef, next, prev]);
}

function useSwipe(next: () => void, prev: () => void): Pick<StoryNavigation, 'onTouchStart' | 'onTouchEnd'> {
    const start = useRef<{ x: number; y: number } | null>(null);
    const onTouchStart = useCallback((e: TouchEvent): void => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY } : null;
    }, []);
    const onTouchEnd = useCallback((e: TouchEvent): void => {
        const from = start.current;
        const t = e.changedTouches[0];
        start.current = null;
        if (!from || !t) return;
        const dx = t.clientX - from.x;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(t.clientY - from.y)) return;
        if (dx < 0) next(); else prev();
    }, [next, prev]);
    return { onTouchStart, onTouchEnd };
}

/**
 * Index state for a paged story. Never wraps and never auto-advances; each
 * real move reports through `onIndexChange`.
 */
export function useStoryNavigation(
    count: number,
    initialIndex: number,
    containerRef: RefObject<HTMLElement | null>,
    onIndexChange?: (index: number) => void,
): StoryNavigation {
    const [index, setIndex] = useState(() => clampIndex(initialIndex, count));
    const indexRef = useRef(index);
    const go = useCallback((delta: number): void => {
        const target = clampIndex(indexRef.current + delta, count);
        if (target === indexRef.current) return;
        indexRef.current = target;
        setIndex(target);
        onIndexChange?.(target);
    }, [count, onIndexChange]);
    const next = useCallback(() => go(1), [go]);
    const prev = useCallback(() => go(-1), [go]);
    useArrowKeys(containerRef, next, prev);
    const swipe = useSwipe(next, prev);
    return { index, atStart: index === 0, atEnd: index >= count - 1, next, prev, ...swipe };
}
