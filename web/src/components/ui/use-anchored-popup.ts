/**
 * useAnchoredPopup — keeps a `<body>`-portalled popup under its anchor and
 * closes it on an outside press (ROK-1646, `Combobox`). The popup is `fixed`,
 * so it escapes a Modal's / BottomSheet's `overflow` clipping; its position is
 * re-measured on any scroll (capture phase, so inner scrollers count) and on
 * resize. No scroll lock: the popup follows the page instead of freezing it.
 * Portalled into a transformed dialog, `fixed` is relative to that dialog, so
 * the measured position is corrected by the popup's real containing-block origin.
 * A `fixed` popup cannot be scrolled into view, so it flips above the anchor when
 * its rendered height does not fit below, and is clamped into the viewport when
 * it fits neither side (ROK-2030: the hub Manage menu's last item was unreachable).
 * Portalled into a non-`<body>` container (a Modal's `overflow-hidden` dialog), it
 * flips/clamps within that container's rect instead and reports a `maxHeight`
 * (the roomier side of the anchor), so a long listbox scrolls instead of being clipped.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** `maxHeight` is set only when the popup lives in a clipping container (not `<body>`). */
export interface PopupPosition { top: number; left: number; width: number; maxHeight?: number }

/** The vertical extent a popup must stay inside (viewport px). */
export interface PlacementBounds { top: number; bottom: number }

/** Which popup edge lines up with the anchor's matching edge. */
export type PopupAlign = 'start' | 'end';

const GAP_PX = 4;
/** Clearance kept from the viewport edge when flipping or clamping. */
const EDGE_PX = 8;

/**
 * The popup's viewport `top` inside `bounds`: below the anchor when it fits, else
 * above it, else clamped so as much of it as possible is inside (top edge first).
 */
export function placeWithin(anchor: PlacementBounds, height: number, bounds: PlacementBounds): number {
    const min = bounds.top + EDGE_PX;
    const max = bounds.bottom - EDGE_PX;
    const below = anchor.bottom + GAP_PX;
    if (below + height <= max) return below;
    const above = anchor.top - GAP_PX - height;
    if (above >= min) return above;
    return Math.max(min, Math.min(below, max - height));
}

/** `placeWithin` against the viewport (`0..viewportHeight`). */
export function placeTop(anchor: PlacementBounds, height: number, viewportHeight: number): number {
    return placeWithin(anchor, height, { top: 0, bottom: viewportHeight });
}

/** The tallest the popup may be inside `bounds`: the roomier side of the anchor (whole px, ≥ 0). */
export function maxHeightWithin(anchor: PlacementBounds, bounds: PlacementBounds): number {
    const below = bounds.bottom - EDGE_PX - (anchor.bottom + GAP_PX);
    const above = anchor.top - GAP_PX - (bounds.top + EDGE_PX);
    return Math.max(0, Math.floor(Math.max(below, above)));
}

function samePos(a: PopupPosition | null, b: PopupPosition): boolean {
    return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight;
}

/** Viewport offset of the popup's containing block (non-zero inside a transformed dialog). */
function containingOrigin(el: HTMLElement | null): { x: number; y: number } {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left - (parseFloat(el.style.left) || 0), y: r.top - (parseFloat(el.style.top) || 0) };
}

/** The popup's `left`: the anchor's left edge, or (for `end`) its right edge minus the popup's width. */
function alignedLeft(anchor: DOMRect, popup: HTMLElement | null, align: PopupAlign): number {
    if (align === 'start') return anchor.left;
    return anchor.right - (popup?.getBoundingClientRect().width ?? 0);
}

/** The portal container's visible rect when it is not `<body>` (it clips the popup), else `null`. */
function clippingBounds(popup: HTMLElement | null): PlacementBounds | null {
    const host = popup?.parentElement;
    if (!host || host === document.body || host === document.documentElement) return null;
    const r = host.getBoundingClientRect();
    return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) };
}

/** Measure one placement: viewport rules for `<body>`, container rules (+ `maxHeight`) otherwise. */
function measurePlacement(anchor: DOMRect, popup: HTMLElement | null, align: PopupAlign): PopupPosition {
    const o = containingOrigin(popup);
    const bounds = clippingBounds(popup);
    const height = popup?.getBoundingClientRect().height ?? 0;
    const left = alignedLeft(anchor, popup, align) - o.x;
    if (!bounds) return { top: placeTop(anchor, height, window.innerHeight) - o.y, left, width: anchor.width };
    const maxHeight = maxHeightWithin(anchor, bounds);
    const top = placeWithin(anchor, Math.min(height, maxHeight), bounds) - o.y;
    return { top, left, width: anchor.width, maxHeight };
}

function usePopupPosition(
    anchorRef: RefObject<HTMLElement | null>, popupRef: RefObject<HTMLElement | null>, open: boolean, align: PopupAlign,
): PopupPosition | null {
    const [pos, setPos] = useState<PopupPosition | null>(null);
    useLayoutEffect(() => {
        if (!open) return;
        const measure = (): void => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (!r) return;
            const next = measurePlacement(r, popupRef.current, align);
            setPos((prev) => (samePos(prev, next) ? prev : next));
        };
        measure();
        // The popup can grow after opening (a combobox's results arrive), so a
        // fit decided at open time is re-checked when its size changes.
        const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
        if (popupRef.current) resized?.observe(popupRef.current);
        window.addEventListener('scroll', measure, true);
        window.addEventListener('resize', measure);
        return () => {
            resized?.disconnect();
            window.removeEventListener('scroll', measure, true);
            window.removeEventListener('resize', measure);
        };
    }, [open, anchorRef, popupRef, align]);
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

/**
 * Position the popup under `anchorRef` (above it when it does not fit below, see
 * `placeWithin`; inside a non-`<body>` portal container also cap it with
 * `maxHeight`, which the caller applies); call `onOutside` on a press outside both.
 * `align: 'end'` lines the popup's right edge up with the anchor's (measured, not
 * a CSS transform, which `containingOrigin` would read back and cancel).
 */
export function useAnchoredPopup(
    anchorRef: RefObject<HTMLElement | null>,
    popupRef: RefObject<HTMLElement | null>,
    open: boolean,
    onOutside: () => void,
    align: PopupAlign = 'start',
): PopupPosition | null {
    useOutsidePress([anchorRef, popupRef], open, onOutside);
    return usePopupPosition(anchorRef, popupRef, open, align);
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
