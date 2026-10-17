import { useSyncExternalStore } from 'react';

export type ScrollDirection = 'up' | 'down' | null;

/** Minimum scroll distance from top before we report "down". */
const SCROLL_THRESHOLD = 100;

/** Breakpoint above which scroll-hiding is disabled (desktop). */
const DESKTOP_MIN_WIDTH = 768;

/* ──────────────────────────────────────────────────────────
   Singleton scroll-direction store
   All callers share ONE scroll listener and ONE rAF loop.
   ────────────────────────────────────────────────────────── */

let direction: ScrollDirection = null;
let lastScrollY = 0;
let ticking = false;
let listenerAttached = false;
let subscriberCount = 0;
const subscribers = new Set<() => void>();

function notify() {
    subscribers.forEach((cb) => cb());
}

function update() {
    const currentY = window.scrollY;

    if (currentY > lastScrollY && currentY > SCROLL_THRESHOLD) {
        if (direction !== 'down') {
            direction = 'down';
            notify();
        }
    } else if (currentY < lastScrollY) {
        if (direction !== 'up') {
            direction = 'up';
            notify();
        }
    }

    lastScrollY = currentY;
    ticking = false;
}

function onScroll() {
    if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
    }
}

function attach() {
    if (listenerAttached) return;
    const mql = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`);
    if (!mql.matches) return;

    lastScrollY = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
    listenerAttached = true;

    // Handle viewport resize (e.g. rotating device)
    mql.addEventListener('change', onMediaChange);
}

function detach() {
    window.removeEventListener('scroll', onScroll);
    const mql = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`);
    mql.removeEventListener('change', onMediaChange);
    listenerAttached = false;
    if (direction !== null) {
        direction = null;
        notify();
    }
}

function onMediaChange(e: MediaQueryListEvent) {
    if (e.matches) {
        attach();
    } else {
        detach();
    }
}

function subscribe(cb: () => void) {
    subscribers.add(cb);
    subscriberCount++;
    if (subscriberCount === 1) {
        attach();
    }
    return () => {
        subscribers.delete(cb);
        subscriberCount--;
        if (subscriberCount === 0) {
            detach();
        }
    };
}

function getSnapshot(): ScrollDirection {
    return direction;
}

/**
 * Reports the user's scroll direction on mobile viewports.
 *
 * Uses a passive scroll listener throttled via `requestAnimationFrame`.
 * Returns `'down'` once the user has scrolled past {@link SCROLL_THRESHOLD}
 * and is moving downward, `'up'` on any upward movement, or `null` before
 * any scroll activity (or on desktop).
 *
 * Internally backed by a singleton store — multiple callers share ONE
 * scroll listener regardless of how many components use the hook.
 *
 * The listener is only attached when >= 1 subscriber exists and is
 * cleaned up when all subscribers unmount.
 */
export function useScrollDirection(): ScrollDirection {
    return useSyncExternalStore(subscribe, getSnapshot);
}
