import { useSyncExternalStore } from 'react';

/**
 * ROK-1640/ROK-1641: every size `BottomSheet` sets comes from the VISIBLE
 * viewport, read from `window.visualViewport` (falling back to `innerHeight`).
 *
 * Why not CSS units: `vh` ignores Safari's toolbars, and on a real iPad
 * (Safari toolbar at the top) `100dvh` still left the overlay layer ~100 CSS px
 * taller than the screen, so a short sheet (the time card's ⋯: Rally, Lock)
 * and the game-time drawer's pinned Save footer opened below the bottom edge.
 * Chromium and Playwright's WebKit do not reproduce that; `visualViewport` is
 * by definition the part of the page the user can see.
 */

/**
 * CSS variable `BottomSheet` sets on its layer: 1% of the visible height, in px.
 * Sheet content sizes with `calc(var(--sheet-vh,1dvh) * N ...)`, never `dvh`.
 */
export const SHEET_VH_VAR = '--sheet-vh';

type Viewport = { height: number; offsetTop: number };

function subscribe(onChange: () => void): () => void {
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onChange);
    vv?.addEventListener('scroll', onChange);
    window.addEventListener('resize', onChange);
    return () => {
        vv?.removeEventListener('resize', onChange);
        vv?.removeEventListener('scroll', onChange);
        window.removeEventListener('resize', onChange);
    };
}

const readHeight = () => window.visualViewport?.height ?? window.innerHeight;
const readOffsetTop = () => window.visualViewport?.offsetTop ?? 0;

/**
 * The visible viewport's height alone, in CSS px (0 with no window). ROK-1661:
 * the app shell (`Layout.tsx`) floors its min-height on this, so a short page's
 * footer sits at the visible bottom on iPad Safari instead of ~100px below it.
 * Height only, so an `offsetTop` change does not re-render the shell.
 */
export function useVisibleHeight(): number {
    return useSyncExternalStore(subscribe, readHeight, () => 0);
}

/** The visible viewport's height and top offset, in CSS px, kept current on resize/scroll. */
export function useVisibleViewport(): Viewport {
    const height = useVisibleHeight();
    const offsetTop = useSyncExternalStore(subscribe, readOffsetTop, () => 0);
    return { height, offsetTop };
}

/**
 * `60vh` → `0.6 × visible height` px; any other unit (`px`, `%`, `rem`) passes
 * through. A zero height (no window, as under SSR) also passes through.
 */
export function toVisiblePx(value: string, visibleHeight: number): string {
    const vh = /^(\d+(?:\.\d+)?)d?vh$/.exec(value.trim());
    if (!vh || visibleHeight <= 0) return value;
    return `${Math.floor((Number(vh[1]) / 100) * visibleHeight)}px`;
}
