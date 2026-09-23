/**
 * useAnchoredPopup — keeps a `<body>`-portalled popup under its anchor and
 * closes it on an outside press (ROK-1646, `Combobox`). The popup is `fixed`,
 * so it escapes a Modal's / BottomSheet's `overflow` clipping; its position is
 * re-measured on any scroll (capture phase, so inner scrollers count) and on
 * resize. No scroll lock: the popup follows the page instead of freezing it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface PopupPosition { top: number; left: number; width: number }

const GAP_PX = 4;

function samePos(a: PopupPosition | null, b: PopupPosition): boolean {
    return !!a && a.top === b.top && a.left === b.left && a.width === b.width;
}

function usePopupPosition(anchorRef: RefObject<HTMLElement | null>, open: boolean): PopupPosition | null {
    const [pos, setPos] = useState<PopupPosition | null>(null);
    useLayoutEffect(() => {
        if (!open) return;
        const measure = (): void => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (!r) return;
            const next = { top: r.bottom + GAP_PX, left: r.left, width: r.width };
            setPos((prev) => (samePos(prev, next) ? prev : next));
        };
        measure();
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open, anchorRef]);
    return pos;
}

function useOutsidePress(refs: RefObject<HTMLElement | null>[], open: boolean, onOutside: () => void): void {
    const latest = useRef(onOutside);
    const targets = useRef(refs);
    useEffect(() => { latest.current = onOutside; targets.current = refs; });
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            const t = e.target as Node;
            if (targets.current.every((r) => !r.current?.contains(t))) latest.current();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
}

/** Position the popup under `anchorRef`; call `onOutside` on a press outside both. */
export function useAnchoredPopup(
    anchorRef: RefObject<HTMLElement | null>,
    popupRef: RefObject<HTMLElement | null>,
    open: boolean,
    onOutside: () => void,
): PopupPosition | null {
    useOutsidePress([anchorRef, popupRef], open, onOutside);
    return usePopupPosition(anchorRef, open);
}

/** Keep the active option visible inside the scrolling listbox. */
export function useScrollIntoView(id: string | undefined): void {
    useEffect(() => {
        if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
    }, [id]);
}
