/**
 * ROK-2075 — zoom + pan for the Gallery viewer stage (§4.29). Hand-rolled on
 * pointer events (no gesture dependency), maths in `gallery-zoom.math.ts`:
 * - pinch (two pointers) zooms about the fingers and follows their midpoint;
 * - Ctrl/⌘ + wheel (a trackpad pinch arrives as ctrl + wheel) zooms about the
 *   pointer; a plain wheel is left alone so the sheet still scrolls;
 * - a double-tap / double-click toggles fit ↔ 2× about the tap;
 * - one pointer drags the picture while zoomed, clamped to the stage;
 * - at fit, a horizontal touch swipe calls `onSwipe` (never while zoomed);
 * - `+` / `-` / `0` keys and arrows (pan, only while zoomed) via `onKeyDown`.
 * A new `resetKey` (the picture id) returns to fit; unmounting (close) drops the state.
 */
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    GALLERY_KEY_PAN_PX, GALLERY_TAP_SLOP_PX, GALLERY_ZOOM_MAX, GALLERY_ZOOM_STEP, INITIAL_ZOOM_STATE, type Point, type ZoomAction,
    type ZoomState, isAtFit, isDoubleTap, pinchGeometry, swipeDirection, wheelDeltaPx, wheelZoomFactor, zoomReducer,
} from './gallery-zoom.math';

export type GallerySwipe = 'prev' | 'next';

export interface GalleryZoomOptions {
    /** Changing it (the shown picture) resets to fit. */
    resetKey: unknown;
    /** At fit only: a horizontal touch swipe. Left = `next`. */
    onSwipe?: (direction: GallerySwipe) => void;
}

export interface GalleryZoomHandlers {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

export interface GalleryZoomApi {
    /** Callback ref for the stage (the clipped well): measured, and the wheel listener target. */
    bindStage: (el: HTMLElement | null) => void;
    /** Callback ref for the transformed element (the `<img>` or its wrapper), laid out at fit size. */
    bindContent: (el: HTMLElement | null) => void;
    /** Spread on the stage. */
    handlers: GalleryZoomHandlers;
    /** Attach where focus sits (the viewer region): `+` `-` `0`, arrows pan while zoomed. */
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    /** On the stage: `touch-action` (`pan-y` at fit so the sheet scrolls, `none` zoomed) and the grab cursor. */
    stageStyle: CSSProperties;
    /** On the content: `translate() scale()` about its centre. */
    contentStyle: CSSProperties;
    zoom: number;
    atFit: boolean;
    /** The last change was a discrete step — add `motion-safe:transition-transform` for it. */
    animating: boolean;
    canZoomIn: boolean;
    canZoomOut: boolean;
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
}

interface Gesture {
    pointers: Map<number, Point>;
    start: Point | null;
    moved: boolean;
    multi: boolean;
    touch: boolean;
    lastTap: { time: number; point: Point } | null;
}

/** A client point measured from the centre of `el`. */
export function fromCentre(el: Element, clientX: number, clientY: number): Point {
    const r = el.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
}

function useMeasure(stage: HTMLElement | null, content: HTMLElement | null, dispatch: (a: ZoomAction) => void): void {
    useEffect(() => {
        if (stage === null || content === null) return undefined;
        const measure = (): void => dispatch({
            type: 'measure',
            view: { width: stage.clientWidth, height: stage.clientHeight },
            fit: { width: content.offsetWidth, height: content.offsetHeight },
        });
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(stage);
        ro.observe(content);
        return () => ro.disconnect();
    }, [stage, content, dispatch]);
}

function useWheel(stage: HTMLElement | null, dispatch: (a: ZoomAction) => void): void {
    useEffect(() => {
        if (stage === null) return undefined;
        const onWheel = (e: WheelEvent): void => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const px = wheelDeltaPx(e.deltaY, e.deltaMode, stage.clientHeight);
            dispatch({ type: 'zoomBy', factor: wheelZoomFactor(px), anchor: fromCentre(stage, e.clientX, e.clientY) });
        };
        stage.addEventListener('wheel', onWheel, { passive: false });
        return () => stage.removeEventListener('wheel', onWheel);
    }, [stage, dispatch]);
}

/** One pointer moved: pinch when two are down, else drag (the reducer clamps a drag at fit to nothing). */
function movePointer(g: Gesture, id: number, point: Point, dispatch: (a: ZoomAction) => void): void {
    const prev = g.pointers.get(id);
    if (prev === undefined) return;
    const others = [...g.pointers.entries()].filter(([k]) => k !== id).map(([, p]) => p);
    g.pointers.set(id, point);
    if (g.start !== null && Math.hypot(point.x - g.start.x, point.y - g.start.y) > GALLERY_TAP_SLOP_PX) g.moved = true;
    const other = others[0];
    if (other !== undefined) {
        dispatch({ type: 'pinch', before: pinchGeometry(prev, other), after: pinchGeometry(point, other) });
        return;
    }
    dispatch({ type: 'pan', dx: point.x - prev.x, dy: point.y - prev.y });
}

/** The last pointer lifted: a tap (maybe the second of a double-tap), a swipe at fit, or the end of a drag/pinch. */
function endGesture(g: Gesture, point: Point, atFit: boolean, dispatch: (a: ZoomAction) => void, onSwipe?: (d: GallerySwipe) => void): void {
    const start = g.start;
    if (!g.multi && !g.moved) {
        const now = Date.now();
        if (isDoubleTap(g.lastTap, now, point)) {
            g.lastTap = null;
            dispatch({ type: 'toggle', anchor: point });
        } else g.lastTap = { time: now, point };
    } else if (!g.multi && atFit && g.touch && start !== null) {
        const dir = swipeDirection(point.x - start.x, point.y - start.y);
        if (dir !== null) onSwipe?.(dir);
    }
    dispatch({ type: 'settle' });
    g.start = null;
    g.moved = false;
    g.multi = false;
}

function usePointerHandlers(state: ZoomState, dispatch: (a: ZoomAction) => void, onSwipe?: (d: GallerySwipe) => void): GalleryZoomHandlers {
    const g = useRef<Gesture>({ pointers: new Map(), start: null, moved: false, multi: false, touch: false, lastTap: null });
    const live = useRef({ atFit: isAtFit(state), onSwipe });
    const atFit = isAtFit(state);
    useEffect(() => { live.current = { atFit, onSwipe }; }, [atFit, onSwipe]);
    return useMemo(() => {
        const lift = (e: PointerEvent<HTMLElement>, cancelled: boolean): void => {
            const gesture = g.current;
            if (!gesture.pointers.delete(e.pointerId) || gesture.pointers.size > 0) return;
            if (cancelled) gesture.multi = true; // a cancelled gesture is neither a tap nor a swipe
            endGesture(gesture, fromCentre(e.currentTarget, e.clientX, e.clientY), live.current.atFit, dispatch, live.current.onSwipe);
        };
        return {
            onPointerDown: (e) => {
                const gesture = g.current;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                // Prev / Next / zoom controls sit over the stage: capturing their pointer would swallow the click.
                if (e.target instanceof Element && e.target.closest('button, a') !== null) return;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                const point = fromCentre(e.currentTarget, e.clientX, e.clientY);
                gesture.pointers.set(e.pointerId, point);
                if (gesture.pointers.size === 1) Object.assign(gesture, { start: point, moved: false, multi: false, touch: e.pointerType !== 'mouse' });
                else gesture.multi = true;
            },
            onPointerMove: (e) => movePointer(g.current, e.pointerId, fromCentre(e.currentTarget, e.clientX, e.clientY), dispatch),
            onPointerUp: (e) => lift(e, false),
            onPointerCancel: (e) => lift(e, true),
        };
    }, [dispatch]);
}

const PAN_KEYS: Record<string, [number, number]> = {
    ArrowLeft: [GALLERY_KEY_PAN_PX, 0], ArrowRight: [-GALLERY_KEY_PAN_PX, 0], ArrowUp: [0, GALLERY_KEY_PAN_PX], ArrowDown: [0, -GALLERY_KEY_PAN_PX],
};

function keyAction(key: string, atFit: boolean): ZoomAction | null {
    if (key === '+' || key === '=') return { type: 'zoomBy', factor: GALLERY_ZOOM_STEP, animate: true };
    if (key === '-' || key === '_') return { type: 'zoomBy', factor: 1 / GALLERY_ZOOM_STEP, animate: true };
    if (key === '0') return { type: 'fit' };
    const pan = PAN_KEYS[key];
    return pan !== undefined && !atFit ? { type: 'pan', dx: pan[0], dy: pan[1], animate: true } : null;
}

function useKeyDown(atFit: boolean, dispatch: (a: ZoomAction) => void): (e: KeyboardEvent<HTMLElement>) => void {
    return useCallback((e: KeyboardEvent<HTMLElement>) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl/⌘ + / − stay the browser's page zoom
        const target = e.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        const action = keyAction(e.key, atFit);
        if (action === null) return;
        e.preventDefault();
        e.stopPropagation(); // an arrow that pans must not also walk to the next picture
        dispatch(action);
    }, [atFit, dispatch]);
}

/** Reset to fit when `resetKey` changes — during render, so the next picture never paints zoomed. */
function useResetOn(resetKey: unknown, dispatch: (a: ZoomAction) => void): void {
    const [seen, setSeen] = useState(resetKey);
    if (!Object.is(seen, resetKey)) {
        setSeen(resetKey);
        dispatch({ type: 'reset' });
    }
}

export function useGalleryZoom({ resetKey, onSwipe }: GalleryZoomOptions): GalleryZoomApi {
    const [state, dispatch] = useReducer(zoomReducer, INITIAL_ZOOM_STATE);
    const [stage, bindStage] = useState<HTMLElement | null>(null);
    const [content, bindContent] = useState<HTMLElement | null>(null);
    useResetOn(resetKey, dispatch);
    useMeasure(stage, content, dispatch);
    useWheel(stage, dispatch);
    const atFit = isAtFit(state);
    const handlers = usePointerHandlers(state, dispatch, onSwipe);
    const onKeyDown = useKeyDown(atFit, dispatch);
    const commands = useMemo(() => ({
        zoomIn: () => dispatch({ type: 'zoomBy', factor: GALLERY_ZOOM_STEP, animate: true }),
        zoomOut: () => dispatch({ type: 'zoomBy', factor: 1 / GALLERY_ZOOM_STEP, animate: true }),
        fit: () => dispatch({ type: 'fit' }),
    }), []);
    return {
        bindStage, bindContent, handlers, onKeyDown, ...commands,
        stageStyle: { touchAction: atFit ? 'pan-y' : 'none', cursor: atFit ? 'auto' : 'grab' },
        contentStyle: { transform: `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`, transformOrigin: 'center center' },
        zoom: state.zoom, atFit, animating: state.animate,
        canZoomIn: state.zoom < GALLERY_ZOOM_MAX - 1e-3, canZoomOut: !atFit,
    };
}
