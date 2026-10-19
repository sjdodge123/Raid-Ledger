/**
 * ROK-1837 D10 — pointer / wheel / keyboard wiring over the pure
 * `viewportReducer`. Spread `handlers` and `style` on the viewport element
 * only: its `touch-action: none` hands touch gestures to us there and nowhere
 * else, so page scroll outside the map stays native. Wheel is bound natively
 * with `passive: false` (React's `onWheel` is passive and cannot stop the page
 * scrolling). 1 pointer pans, 2 pointers pinch about their midpoint, wheel
 * (and ctrl+wheel trackpad pinch) zooms about the cursor, double-click zooms
 * 2× about the point, `+`/`-`/`0`/arrows via `keyToAction`. Focus never
 * scrolls the `overflow: hidden` surface natively: any native scroll is reset to
 * 0 and a focused offscreen descendant (a tabbed-to pin) is panned into view
 * through the reducer, so the DOM never drifts from the managed transform.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
    CSSProperties,
    Dispatch,
    FocusEvent,
    KeyboardEvent,
    MouseEvent,
    PointerEvent,
    RefObject,
    UIEvent,
} from 'react';
import {
    initViewport,
    keyToAction,
    pinchActions,
    viewportReducer,
    type PinchGeometry,
    type Point,
    type ViewportAction,
    type Viewport,
} from './map-viewport.math';

/** Wheel delta → zoom factor sensitivity (≈ 1.22× per 100px notch). */
export const WHEEL_ZOOM_SENSITIVITY = 0.002;
export const BUTTON_ZOOM_FACTOR = 1.5;

/** CSS px per `DOM_DELTA_LINE` line (Firefox mouse wheels report lines). */
export const WHEEL_LINE_PX = 16;

type Pointers = Map<number, Point>;

/** Wheel `deltaY` in px: lines ×16, pages × the surface height (`DOM_DELTA_*`). */
export function wheelDeltaPx(
    e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
    pageHeight: number,
): number {
    if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX;
    if (e.deltaMode === 2) return e.deltaY * pageHeight;
    return e.deltaY;
}

function localPoint(el: Element, clientX: number, clientY: number): Point {
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
}

function pinchGeometry(pointers: Pointers): PinchGeometry | null {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
}

/** Apply one pointer move: pan with one pointer, pinch-zoom + pan with two. */
function movePointer(
    pointers: Pointers,
    id: number,
    next: Point,
    dispatch: Dispatch<ViewportAction>,
): void {
    const prev = pointers.get(id);
    if (!prev) return;
    const before = pinchGeometry(pointers);
    pointers.set(id, next);
    if (pointers.size === 1)
        return dispatch({
            type: 'pan',
            dx: next.x - prev.x,
            dy: next.y - prev.y,
        });
    const after = pinchGeometry(pointers);
    if (!before || !after) return;
    for (const action of pinchActions(before, after)) dispatch(action);
}

function keyDownHandler(dispatch: Dispatch<ViewportAction>) {
    return (e: KeyboardEvent<HTMLElement>) => {
        // Ctrl/Cmd/Alt + `+`/`-`/`0` is the browser's own zoom — leave it alone.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const action = keyToAction(e.key);
        if (!action) return;
        e.preventDefault();
        dispatch(action);
    };
}

function doubleClickHandler(dispatch: Dispatch<ViewportAction>) {
    return (e: MouseEvent<HTMLElement>) =>
        dispatch({
            type: 'zoomBy',
            factor: 2,
            anchor: localPoint(e.currentTarget, e.clientX, e.clientY),
        });
}

/** Gap kept between a keyboard-focused descendant and the surface edge. */
export const FOCUS_PAN_MARGIN = 8;

/** Shift (px) that brings `[lo, hi]` inside `[0, size]` with a margin; 0 when visible. */
export function revealShift(lo: number, hi: number, size: number): number {
    if (lo < FOCUS_PAN_MARGIN) return FOCUS_PAN_MARGIN - lo;
    if (hi > size - FOCUS_PAN_MARGIN) return size - FOCUS_PAN_MARGIN - hi;
    return 0;
}

/** Undo any native scroll of the surface — the transform is the only offset. */
function resetScroll(el: HTMLElement): void {
    if (el.scrollLeft !== 0) el.scrollLeft = 0;
    if (el.scrollTop !== 0) el.scrollTop = 0;
}

/** Focus of a descendant: reset native scroll, then pan it into view via the reducer. */
function focusHandler(dispatch: Dispatch<ViewportAction>) {
    return (e: FocusEvent<HTMLElement>) => {
        const el = e.currentTarget;
        resetScroll(el);
        if (e.target === el) return;
        const box = el.getBoundingClientRect();
        const r = e.target.getBoundingClientRect();
        const dx = revealShift(
            r.left - box.left,
            r.right - box.left,
            el.clientWidth,
        );
        const dy = revealShift(
            r.top - box.top,
            r.bottom - box.top,
            el.clientHeight,
        );
        if (dx !== 0 || dy !== 0) dispatch({ type: 'pan', dx, dy });
    };
}

function usePointerHandlers(dispatch: Dispatch<ViewportAction>) {
    const pointers = useRef<Pointers>(new Map());
    return useMemo(
        () => ({
            onPointerDown: (e: PointerEvent<HTMLElement>) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                pointers.current.set(
                    e.pointerId,
                    localPoint(e.currentTarget, e.clientX, e.clientY),
                );
            },
            onPointerMove: (e: PointerEvent<HTMLElement>) =>
                movePointer(
                    pointers.current,
                    e.pointerId,
                    localPoint(e.currentTarget, e.clientX, e.clientY),
                    dispatch,
                ),
            onPointerUp: (e: PointerEvent<HTMLElement>) =>
                void pointers.current.delete(e.pointerId),
            onPointerCancel: (e: PointerEvent<HTMLElement>) =>
                void pointers.current.delete(e.pointerId),
            onDoubleClick: doubleClickHandler(dispatch),
            onKeyDown: keyDownHandler(dispatch),
            onFocus: focusHandler(dispatch),
            onScroll: (e: UIEvent<HTMLElement>) => resetScroll(e.currentTarget),
        }),
        [dispatch],
    );
}

function useWheelZoom(
    ref: RefObject<HTMLElement | null>,
    dispatch: Dispatch<ViewportAction>,
): void {
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const px = wheelDeltaPx(e, el.clientHeight);
            const factor = Math.exp(-px * WHEEL_ZOOM_SENSITIVITY);
            dispatch({
                type: 'zoomBy',
                factor,
                anchor: localPoint(el, e.clientX, e.clientY),
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [ref, dispatch]);
}

function useViewportSize(
    ref: RefObject<HTMLElement | null>,
    dispatch: Dispatch<ViewportAction>,
): void {
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () =>
            dispatch({
                type: 'resize',
                view: { width: el.clientWidth, height: el.clientHeight },
            });
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, dispatch]);
}

function useViewportCommands(dispatch: Dispatch<ViewportAction>) {
    const zoomIn = useCallback(
        () => dispatch({ type: 'zoomBy', factor: BUTTON_ZOOM_FACTOR }),
        [dispatch],
    );
    const zoomOut = useCallback(
        () => dispatch({ type: 'zoomBy', factor: 1 / BUTTON_ZOOM_FACTOR }),
        [dispatch],
    );
    const fit = useCallback(() => dispatch({ type: 'fit' }), [dispatch]);
    return { zoomIn, zoomOut, fit };
}

/**
 * Gesture-surface styles only. No `position`: the caller owns layout (the map
 * frame passes `absolute inset-0`; an inline `relative` would override it and
 * collapse the surface). `MapViewport` adds `relative` when the caller's
 * class names no position of its own.
 */
export const SURFACE_CLASS =
    'rounded-lg bg-panel border border-edge cursor-grab active:cursor-grabbing select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success';

const POSITIONED = /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/;

/** The surface class: the caller's layout wins; `relative` only as a default. */
export function surfaceClass(className?: string): string {
    if (!className) return `relative ${SURFACE_CLASS}`;
    const position = POSITIONED.test(className) ? '' : 'relative ';
    return `${position}${SURFACE_CLASS} ${className}`;
}

export const VIEWPORT_STYLE: CSSProperties = {
    touchAction: 'none',
    overflow: 'hidden',
    userSelect: 'none',
};

export interface MapViewportApi {
    ref: RefObject<HTMLDivElement | null>;
    viewport: Viewport;
    /** `transform` for the texture-space layer (pair with `transform-origin: 0 0`). */
    transform: string;
    handlers: ReturnType<typeof usePointerHandlers>;
    style: CSSProperties;
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
}

/** Viewport state for a `contentSize`² texture (the grid's `textureSize`); key the caller on it — a new size needs a remount. */
export function useMapViewport(contentSize: number): MapViewportApi {
    const ref = useRef<HTMLDivElement | null>(null);
    const [state, dispatch] = useReducer(
        viewportReducer,
        contentSize,
        (c: number) => initViewport(c),
    );
    useViewportSize(ref, dispatch);
    useWheelZoom(ref, dispatch);
    const handlers = usePointerHandlers(dispatch);
    const { zoomIn, zoomOut, fit } = useViewportCommands(dispatch);
    const { scale, x, y } = state.vp;
    const transform = `translate(${x}px, ${y}px) scale(${scale})`;
    return {
        ref,
        viewport: state.vp,
        transform,
        handlers,
        style: VIEWPORT_STYLE,
        zoomIn,
        zoomOut,
        fit,
    };
}
