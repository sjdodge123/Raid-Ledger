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
 *   new viewport and is taken as-is.
 */

type ShellFloor = { height: number; width: number };

const EMPTY: ShellFloor = { height: 0, width: 0 };

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

function nextShellFloor(prev: ShellFloor): ShellFloor {
    const next = { height: readShellHeight(), width: document.documentElement.clientWidth };
    const keyboardShrink = next.height < prev.height && next.width === prev.width && isEditableFocused();
    if (keyboardShrink) return prev;
    return next.height === prev.height && next.width === prev.width ? prev : next;
}

/** The shell's min-height in CSS px, kept current on viewport resize. */
export function useShellHeight(): number {
    const [floor, setFloor] = useState<ShellFloor>(() => nextShellFloor(EMPTY));
    useEffect(() => {
        const update = () => setFloor(nextShellFloor);
        update();
        const vv = window.visualViewport;
        vv?.addEventListener('resize', update);
        window.addEventListener('resize', update);
        return () => {
            vv?.removeEventListener('resize', update);
            window.removeEventListener('resize', update);
        };
    }, []);
    return floor.height;
}
