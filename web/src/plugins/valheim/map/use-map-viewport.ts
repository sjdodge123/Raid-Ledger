/**
 * ROK-1837 D10 — pointer / wheel / keyboard wiring over the pure
 * `viewportReducer`. Spread `handlers` and `style` on the viewport element
 * only: its `touch-action: none` hands touch gestures to us there and nowhere
 * else, so page scroll outside the map stays native. Wheel is bound natively
 * with `passive: false` (React's `onWheel` is passive and cannot stop the page
 * scrolling). 1 pointer pans, 2 pointers pinch about their midpoint, wheel
 * (and ctrl+wheel trackpad pinch) zooms about the cursor, double-click zooms
 * 2× about the point, `+`/`-`/`0`/arrows via `keyToAction`.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
    CSSProperties,
    Dispatch,
    KeyboardEvent,
    MouseEvent,
    PointerEvent,
    RefObject,
} from 'react';
import {
    initViewport,
    keyToAction,
    viewportReducer,
    type Point,
    type ViewportAction,
    type Viewport,
} from './map-viewport.math';

/** Wheel delta → zoom factor sensitivity (≈ 1.22× per 100px notch). */
export const WHEEL_ZOOM_SENSITIVITY = 0.002;
export const BUTTON_ZOOM_FACTOR = 1.5;

type Pointers = Map<number, Point>;

function localPoint(el: Element, clientX: number, clientY: number): Point {
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
}

function pinchGeometry(
    pointers: Pointers,
): { mid: Point; dist: number } | null {
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
    if (!before || !after || before.dist === 0) return;
    dispatch({
        type: 'zoomBy',
        factor: after.dist / before.dist,
        anchor: after.mid,
    });
    dispatch({
        type: 'pan',
        dx: after.mid.x - before.mid.x,
        dy: after.mid.y - before.mid.y,
    });
}

function keyDownHandler(dispatch: Dispatch<ViewportAction>) {
    return (e: KeyboardEvent<HTMLElement>) => {
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
            const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
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

export const VIEWPORT_STYLE: CSSProperties = {
    touchAction: 'none',
    overflow: 'hidden',
    position: 'relative',
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
