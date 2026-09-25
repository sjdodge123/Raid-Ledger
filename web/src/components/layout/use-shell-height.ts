import { useEffect, useRef, useState } from 'react';

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
 *   new viewport and is taken as-is, as is every read until it settles, except
 *   that with an editable focused it never drops below the last height read at
 *   that width with nothing focused: a turn made with the keyboard up must not
 *   floor on the keyboard-shrunk height.
 *
 * Scrolling past the end is NOT this floor's job: iPad Safari lets any page
 * scroll or pan past the document's end, so no min-height can keep the footer
 * on screen at rest AND leave nothing below it at the end of that scroll. That
 * run-out shows the root canvas colour, which `index.css` sets to the footer's
 * `--color-surface` (html) with body left transparent.
 */

/**
 * `settling` is true from a read that saw the layout width change (rotation)
 * until the final settle read: through that window every read is taken as-is
 * (floored by `restHeights` while editing), so a field focused across a
 * rotation cannot pin a mid-rotation height. `restHeights` is the last height
 * read at each layout width with no editable focused.
 */
type ShellFloor = {
    height: number;
    width: number;
    settling: boolean;
    restHeights: Readonly<Record<number, number>>;
};

const EMPTY: ShellFloor = { height: 0, width: 0, settling: false, restHeights: {} };

const NON_TEXT_INPUTS = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/** The visible height with pinch-zoom undone, in CSS px. */
function readShellHeight(): number {
    const vv = window.visualViewport;
    return Math.round(vv ? vv.height * vv.scale : window.innerHeight);
}

function isEditable(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(el.type);
}

function isEditableFocused(): boolean {
    return isEditable(document.activeElement);
}

function withRestHeight(prev: ShellFloor, width: number, height: number): ShellFloor['restHeights'] {
    return prev.restHeights[width] === height ? prev.restHeights : { ...prev.restHeights, [width]: height };
}

function nextShellFloor(prev: ShellFloor, final: boolean): ShellFloor {
    const read = readShellHeight();
    const width = document.documentElement.clientWidth;
    const editing = isEditableFocused();
    const rotating = width !== prev.width || prev.settling;
    if (editing && !rotating && read < prev.height) return prev; // the keyboard
    const height = editing && rotating ? Math.max(read, prev.restHeights[width] ?? 0) : read;
    const restHeights = editing ? prev.restHeights : withRestHeight(prev, width, read);
    const settling = rotating && !final;
    const same = height === prev.height && width === prev.width && settling === prev.settling
        && restHeights === prev.restHeights;
    return same ? prev : { height, width, settling, restHeights };
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

/**
 * Closing the on-screen keyboard leaves iOS scrolled wherever it moved the
 * focused field, which on a page no taller than the floor is the run-out below
 * the footer. Once the visible height is back at the floor with nothing
 * editable focused, such a page returns to the scroll saved when the field was
 * focused. A taller page is left alone: there is real content where it is.
 */
function subscribeKeyboardScrollRestore(getFloor: () => number): () => void {
    const vv = window.visualViewport;
    if (!vv) return () => undefined;
    let saved: number | null = null;
    const atFloor = () => readShellHeight() >= getFloor() - 1;
    const onFocusIn = (e: FocusEvent) => {
        if (saved === null && isEditable(e.target)) saved = window.scrollY;
    };
    // Focus left with no shrink (a hardware keyboard): nothing to restore later.
    const onFocusOut = () => { if (atFloor()) saved = null; };
    const onResize = () => {
        if (saved === null || isEditableFocused() || !atFloor()) return;
        const y = saved;
        saved = null;
        if (document.documentElement.scrollHeight <= getFloor() + 1) window.scrollTo(window.scrollX, y);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv.addEventListener('resize', onResize);
    return () => {
        document.removeEventListener('focusin', onFocusIn);
        document.removeEventListener('focusout', onFocusOut);
        vv.removeEventListener('resize', onResize);
    };
}

/**
 * The shell's min-height in CSS px, kept current on viewport resize and rotation.
 * `enabled: false` (the DEMO-only `?noshellfloor=1` experiment) returns 0 and
 * runs no listener or sentinel at all.
 */
export function useShellHeight(enabled = true): number {
    const [floor, setFloor] = useState<ShellFloor>(() => nextShellFloor(EMPTY, true));
    const floorRef = useRef(floor.height);
    useEffect(() => { floorRef.current = floor.height; }, [floor.height]);
    useEffect(() => {
        if (!enabled) return undefined;
        return subscribeToViewport((final) => setFloor((prev) => nextShellFloor(prev, final)));
    }, [enabled]);
    useEffect(() => (enabled ? subscribeKeyboardScrollRestore(() => floorRef.current) : undefined), [enabled]);
    return enabled ? floor.height : 0;
}
