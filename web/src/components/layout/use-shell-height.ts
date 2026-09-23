import { useEffect, useState } from 'react';

/**
 * ROK-1661: the height the app shell (`Layout.tsx`) floors its min-height on.
 *
 * It starts from the VISIBLE viewport, as ROK-1640's bottom sheet does
 * (`ui/bottom-sheet-viewport.ts`): on a real iPad `100dvh` resolves ~100 CSS px
 * taller than the screen. Unlike the sheet, which is an overlay and should
 * follow zoom and the keyboard, the shell is in document flow, so two things
 * that shrink `visualViewport.height` are kept out of it:
 *
 * - **Pinch-zoom.** `visualViewport.height` is the layout height ÷ `scale`, so
 *   the floor multiplies the scale back in. At 2x the floor does not halve.
 * - **The on-screen keyboard.** iOS Safari, and Android Chrome by default
 *   (no `interactive-widget` in index.html), shrink only the visual viewport.
 *   While an editable element has focus and the layout width is unchanged, a
 *   shrink is the keyboard, so the floor holds. A width change (rotation) is a
 *   new viewport and is taken as-is, as is every read until it settles.
 *
 * Scrolling past the end is NOT this floor's job: iPad Safari lets any page
 * scroll to the bottom of its larger layout viewport, so no min-height can keep
 * the footer on screen at rest AND leave nothing below it at the end of that
 * scroll. `Footer.tsx` paints that run-out instead (`FOOTER_RUNOUT_SHADOW`).
 */

/**
 * `settling` is true from a read that saw the layout width change (rotation)
 * until the final settle read: through that window every read is taken as-is,
 * so a field focused across a rotation cannot pin a mid-rotation height.
 */
type ShellFloor = { height: number; width: number; settling: boolean };

const EMPTY: ShellFloor = { height: 0, width: 0, settling: false };

const NON_TEXT_INPUTS = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/** The visible height with pinch-zoom undone, in CSS px. */
function readShellHeight(): number {
    const vv = window.visualViewport;
    return Math.round(vv ? vv.height * vv.scale : window.innerHeight);
}

function isEditableFocused(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
}

function nextShellFloor(prev: ShellFloor, final: boolean): ShellFloor {
    const height = readShellHeight();
    const width = document.documentElement.clientWidth;
    const widthChanged = width !== prev.width;
    const keyboardShrink = height < prev.height && !widthChanged && !prev.settling && isEditableFocused();
    if (keyboardShrink) return prev;
    const settling = (widthChanged || prev.settling) && !final;
    const same = height === prev.height && !widthChanged && settling === prev.settling;
    return same ? prev : { height, width, settling };
}

/**
 * Wait after a viewport event before the last re-read. iOS fires `resize` (and
 * `orientationchange`) BEFORE a rotated viewport settles and no event fires once
 * it has, so a height read at event time can stick (ROK-1661 iPad plan: after a
 * landscape→portrait turn the shell kept a floor ~80 px short of the screen).
 * The layout-viewport sentinel (`observeLayoutViewport`) usually reports the
 * settle itself; these timed reads are the fallback.
 */
export const SHELL_SETTLE_MS = 150;

/** A second, later timed re-read, for a rotation still settling at SHELL_SETTLE_MS. */
export const SHELL_LATE_SETTLE_MS = 500;

type Listener = [EventTarget | null | undefined, string];

function viewportListeners(): Listener[] {
    return [
        [window.visualViewport, 'resize'],
        [window, 'resize'],
        [window, 'orientationchange'],
        [typeof screen === 'undefined' ? undefined : screen.orientation, 'change'],
    ];
}

/**
 * Watches a hidden `position: fixed; inset: 0` element, which is exactly the
 * layout viewport, so `onChange` runs whenever the layout viewport itself
 * resizes — including the settle of a rotation, which no event reports.
 */
function observeLayoutViewport(onChange: () => void): () => void {
    if (typeof ResizeObserver === 'undefined') return () => undefined;
    const sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.setAttribute('data-shell-viewport-sentinel', '');
    sentinel.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden';
    document.body.appendChild(sentinel);
    const observer = new ResizeObserver(() => onChange());
    observer.observe(sentinel);
    return () => {
        observer.disconnect();
        sentinel.remove();
    };
}

/**
 * Calls `update(false)` on every viewport change and again one frame later,
 * then `update(true)` SHELL_SETTLE_MS and SHELL_LATE_SETTLE_MS after the last
 * change (and once on mount). A change is a viewport event or a resize of the
 * layout-viewport sentinel.
 */
function subscribeToViewport(update: (final: boolean) => void): () => void {
    let frame = 0;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const cancelPending = () => {
        cancelAnimationFrame(frame);
        for (const timer of timers) clearTimeout(timer);
    };
    const onChange = () => {
        update(false);
        cancelPending();
        frame = requestAnimationFrame(() => update(false));
        timers = [SHELL_SETTLE_MS, SHELL_LATE_SETTLE_MS].map((ms) => setTimeout(() => update(true), ms));
    };
    const listeners = viewportListeners();
    update(true);
    for (const [target, type] of listeners) target?.addEventListener(type, onChange);
    const stopObserving = observeLayoutViewport(onChange);
    return () => {
        stopObserving();
        cancelPending();
        for (const [target, type] of listeners) target?.removeEventListener(type, onChange);
    };
}

/** The shell's min-height in CSS px, kept current on viewport resize and rotation. */
export function useShellHeight(): number {
    const [floor, setFloor] = useState<ShellFloor>(() => nextShellFloor(EMPTY, true));
    useEffect(() => subscribeToViewport((final) => setFloor((prev) => nextShellFloor(prev, final))), []);
    return floor.height;
}
