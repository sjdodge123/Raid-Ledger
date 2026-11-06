/**
 * ROK-2075 — pure zoom / pan maths for the Gallery viewer (§4.29). The picture
 * is laid out at its fit size (`object-contain`, never enlarged) and centred in
 * the stage; zoom is a factor over that fit size (1 = fit) and the offset a
 * translate from the stage centre: `screen = zoom · p + (x, y)`, with `p` and
 * every anchor measured from the stage centre. Zoom is clamped to
 * `[1, GALLERY_ZOOM_MAX]` and the offset so the picture never leaves the stage
 * (it stays centred on an axis where it is smaller than the stage).
 */

export const GALLERY_ZOOM_MAX = 4;
/** Double-tap / double-click target from fit. */
export const GALLERY_ZOOM_TOGGLE = 2;
/** One − / + press or key. */
export const GALLERY_ZOOM_STEP = 1.5;
/** A gesture that ends below this zoom settles back to fit (swipe works again). */
export const GALLERY_ZOOM_SNAP = 1.05;
/** Arrow-key pan while zoomed, in screen px. */
export const GALLERY_KEY_PAN_PX = 64;

export interface Point {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
/** Two pointers: their midpoint (from the stage centre) and distance. */
export interface PinchGeometry {
    centre: Point;
    distance: number;
}

export interface ZoomState {
    zoom: number;
    x: number;
    y: number;
    /** The stage's inner size. */
    view: Size;
    /** The picture's untransformed (fit) layout size. */
    fit: Size;
    /** The last change was a discrete step (button, key, double-tap) — the caller may animate it. */
    animate: boolean;
    /** The zoom a screen reader hears: set by discrete steps and when a gesture settles, never per pinch/wheel frame. */
    announced: number;
}

export type ZoomAction =
    | { type: 'measure'; view: Size; fit: Size }
    | { type: 'zoomBy'; factor: number; anchor?: Point; animate?: boolean }
    | { type: 'toggle'; anchor?: Point }
    | { type: 'pan'; dx: number; dy: number; animate?: boolean }
    | { type: 'pinch'; before: PinchGeometry; after: PinchGeometry }
    | { type: 'settle' }
    | { type: 'fit' }
    /** A new picture: back to fit in the same paint, never animated (the next `<img>` must not zoom out). */
    | { type: 'reset' };

const EMPTY: Size = { width: 0, height: 0 };
const FIT_EPSILON = 1e-3;

export const INITIAL_ZOOM_STATE: ZoomState = { zoom: 1, x: 0, y: 0, view: EMPTY, fit: EMPTY, animate: false, announced: 1 };

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function isAtFit(state: Pick<ZoomState, 'zoom'>): boolean {
    return state.zoom <= 1 + FIT_EPSILON;
}

/** How far the offset may travel on one axis: half the overflow, 0 when the picture is smaller. */
function axisLimit(fitLen: number, viewLen: number, zoom: number): number {
    return Math.max(0, (fitLen * zoom - viewLen) / 2);
}

/** Clamp zoom to `[1, max]` and the offset so the picture covers the stage wherever it is larger. */
export function clampZoomState(state: ZoomState): ZoomState {
    const zoom = clamp(state.zoom, 1, GALLERY_ZOOM_MAX);
    const lx = axisLimit(state.fit.width, state.view.width, zoom);
    const ly = axisLimit(state.fit.height, state.view.height, zoom);
    // `+ 0` folds a clamped `-0` into `0`.
    return { ...state, zoom, x: clamp(state.x, -lx, lx) + 0, y: clamp(state.y, -ly, ly) + 0 };
}

/** Zoom to `next`, keeping the picture point under `anchor` (default: the stage centre) fixed. */
export function zoomAbout(state: ZoomState, next: number, anchor: Point = { x: 0, y: 0 }): ZoomState {
    const zoom = clamp(next, 1, GALLERY_ZOOM_MAX);
    const ratio = zoom / state.zoom;
    const x = anchor.x - (anchor.x - state.x) * ratio;
    const y = anchor.y - (anchor.y - state.y) * ratio;
    return clampZoomState({ ...state, zoom, x, y });
}

/** Two-finger move: scale by the distance ratio about the old midpoint, then follow the midpoint. */
export function pinchZoom(state: ZoomState, before: PinchGeometry, after: PinchGeometry): ZoomState {
    if (before.distance <= 0 || after.distance <= 0) return state;
    const zoom = clamp((state.zoom * after.distance) / before.distance, 1, GALLERY_ZOOM_MAX);
    const ratio = zoom / state.zoom;
    const x = after.centre.x - (before.centre.x - state.x) * ratio;
    const y = after.centre.y - (before.centre.y - state.y) * ratio;
    return clampZoomState({ ...state, zoom, x, y });
}

function fitState(state: ZoomState): ZoomState {
    return { ...state, zoom: 1, x: 0, y: 0 };
}

function step(state: ZoomState, action: ZoomAction): ZoomState {
    switch (action.type) {
        case 'measure':
            return clampZoomState({ ...state, view: action.view, fit: action.fit, animate: false });
        case 'zoomBy':
            return { ...zoomAbout(state, state.zoom * action.factor, action.anchor), animate: action.animate ?? false };
        case 'toggle':
            return isAtFit(state) ? { ...zoomAbout(state, GALLERY_ZOOM_TOGGLE, action.anchor), animate: true } : { ...fitState(state), animate: true };
        case 'pan':
            return { ...clampZoomState({ ...state, x: state.x + action.dx, y: state.y + action.dy }), animate: action.animate ?? false };
        case 'pinch':
            return { ...pinchZoom(state, action.before, action.after), animate: false };
        case 'settle':
            return state.zoom < GALLERY_ZOOM_SNAP && !isAtFit(state) ? { ...fitState(state), animate: true } : state;
        case 'fit':
            return { ...fitState(state), animate: true };
        case 'reset':
            return { ...fitState(state), animate: false };
    }
}

/** A continuous frame (pinch, ctrl-wheel, drag) keeps the old `announced`; a discrete step or a settle updates it. */
function announces(action: ZoomAction): boolean {
    return action.type === 'zoomBy' ? action.animate === true : action.type !== 'pinch' && action.type !== 'pan' && action.type !== 'measure';
}

const SAME_KEYS = ['zoom', 'x', 'y', 'view', 'fit', 'animate', 'announced'] as const;

export function zoomReducer(state: ZoomState, action: ZoomAction): ZoomState {
    const stepped = step(state, action);
    const next = announces(action) && stepped.announced !== stepped.zoom ? { ...stepped, announced: stepped.zoom } : stepped;
    // Unchanged (a drag at fit clamps to nothing): keep the old object so React skips the re-render.
    return SAME_KEYS.every((k) => Object.is(next[k], state[k])) ? state : next;
}

/** Midpoint + distance of two points (already relative to the stage centre). */
export function pinchGeometry(a: Point, b: Point): PinchGeometry {
    return { centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

/** Normalise a wheel delta to pixels (`deltaMode` 1 = lines, 2 = pages). */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
    if (deltaMode === 1) return deltaY * 16;
    if (deltaMode === 2) return deltaY * pageHeight;
    return deltaY;
}

/** One wheel event's zoom factor; a large mouse notch is capped so it never jumps more than ~×1.28. */
export const GALLERY_WHEEL_SENSITIVITY = 0.01;
export const GALLERY_WHEEL_MAX_PX = 25;
export function wheelZoomFactor(deltaPx: number): number {
    return Math.exp(-clamp(deltaPx, -GALLERY_WHEEL_MAX_PX, GALLERY_WHEEL_MAX_PX) * GALLERY_WHEEL_SENSITIVITY);
}

/** Swipe rule at fit: a mostly-horizontal single-finger drag of at least 48px. Left = next. */
export const GALLERY_SWIPE_MIN_PX = 48;
export function swipeDirection(dx: number, dy: number): 'prev' | 'next' | null {
    if (Math.abs(dx) < GALLERY_SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
    return dx < 0 ? 'next' : 'prev';
}

/** Two taps within 300ms and 30px are a double-tap. */
export const GALLERY_DOUBLE_TAP_MS = 300;
export const GALLERY_DOUBLE_TAP_PX = 30;
export const GALLERY_TAP_SLOP_PX = 10;
export function isDoubleTap(prev: { time: number; point: Point } | null, time: number, point: Point): boolean {
    if (prev === null) return false;
    return time - prev.time <= GALLERY_DOUBLE_TAP_MS && Math.hypot(point.x - prev.point.x, point.y - prev.point.y) <= GALLERY_DOUBLE_TAP_PX;
}
