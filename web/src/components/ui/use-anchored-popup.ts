/**
 * useAnchoredPopup — keeps a `<body>`-portalled popup under its anchor and
 * closes it on an outside press (ROK-1646, `Combobox`). The popup is `fixed`,
 * so it escapes a Modal's / BottomSheet's `overflow` clipping; its position is
 * re-measured on any scroll (capture phase, so inner scrollers count) and on
 * resize. No scroll lock: the popup follows the page instead of freezing it.
 * Portalled into a transformed dialog, `fixed` is relative to that dialog, so
 * the measured position is corrected by the popup's real containing-block origin.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface PopupPosition { top: number; left: number; width: number }

const GAP_PX = 4;

function samePos(a: PopupPosition | null, b: PopupPosition): boolean {
    return !!a && a.top === b.top && a.left === b.left && a.width === b.width;
}

/** Viewport offset of the popup's containing block (non-zero inside a transformed dialog). */
function containingOrigin(el: HTMLElement | null): { x: number; y: number } {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left - (parseFloat(el.style.left) || 0), y: r.top - (parseFloat(el.style.top) || 0) };
}

function usePopupPosition(
    anchorRef: RefObject<HTMLElement | null>, popupRef: RefObject<HTMLElement | null>, open: boolean,
): PopupPosition | null {
    const [pos, setPos] = useState<PopupPosition | null>(null);
    useLayoutEffect(() => {
        if (!open) return;
        const measure = (): void => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (!r) return;
            const o = containingOrigin(popupRef.current);
            const next = { top: r.bottom + GAP_PX - o.y, left: r.left - o.x, width: r.width };
            setPos((prev) => (samePos(prev, next) ? prev : next));
        };
        measure();
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open, anchorRef, popupRef]);
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
    return usePopupPosition(anchorRef, popupRef, open);
}

/** Keep the active option visible inside the scrolling listbox. */
export function useScrollIntoView(id: string | undefined): void {
    useEffect(() => {
        if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
    }, [id]);
}

/**
 * The anchor as a ref (for measuring) AND as state (so the portal target can be
 * resolved without reading a ref during render): an explicit container wins,
 * else the anchor's `[role="dialog"]`, else `<body>`.
 */
export function usePortalTarget(explicit?: HTMLElement | null) {
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
    const setAnchorRef = useCallback((el: HTMLDivElement | null) => { anchorRef.current = el; setAnchor(el); }, []);
    const container = explicit ?? anchor?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    return { anchorRef, setAnchorRef, container };
}
