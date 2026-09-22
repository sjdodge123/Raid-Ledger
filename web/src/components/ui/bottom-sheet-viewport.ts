/**
 * ROK-1641: on iOS/iPadOS Safari `vh` is the viewport WITHOUT its toolbars
 * and a `fixed inset-0` layer can reach under a bottom toolbar, so a short
 * bottom-anchored sheet (the time card's ⋯: Rally, Lock) opened with its
 * actions hidden. Every height `BottomSheet` sets goes through here: `vh`
 * becomes `dvh` (the visible viewport) where supported, and stays `vh` elsewhere.
 */

function detectDvh(): boolean {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '1dvh');
}

/**
 * Probed ONCE, at module load — support cannot change during a page's life.
 * `false` under SSR/jsdom, where `CSS` or `CSS.supports` may be missing.
 */
export const SUPPORTS_DVH: boolean = detectDvh();

/** `60vh` → `60dvh` when `dvh` is on; any other unit (`px`, `%`, `rem`) passes through. */
export function toDynamicViewport(value: string, dvh: boolean): string {
    return dvh ? value.replace(/(\d)vh\b/g, '$1dvh') : value;
}
