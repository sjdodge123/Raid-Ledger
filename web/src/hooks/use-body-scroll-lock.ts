import { useEffect } from 'react';

/**
 * Ref-counted body scroll lock shared by the overlay primitives (`Modal`,
 * `BottomSheet`). Each open overlay holds one lock; `body` stays
 * `overflow: hidden` until the LAST holder releases it.
 *
 * Why a count: overlays nest — "Discard your changes?" (a `Modal`) opens over
 * the game-time `BottomSheet` (ROK-1640). With a per-overlay `overflow = ''`
 * cleanup, closing the confirm unlocked the page while the sheet was still open.
 *
 * Released locks restore `''` (not a captured previous value): a legacy
 * non-counted lock elsewhere may own `hidden` and clear it on its own.
 */
let holders = 0;

function acquire(): void {
    holders += 1;
    if (holders === 1) document.body.style.overflow = 'hidden';
}

function release(): void {
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.style.overflow = '';
}

/** Lock body scroll while `locked` is true (see file docstring). */
export function useBodyScrollLock(locked: boolean): void {
    useEffect(() => {
        if (!locked) return;
        acquire();
        return release;
    }, [locked]);
}
