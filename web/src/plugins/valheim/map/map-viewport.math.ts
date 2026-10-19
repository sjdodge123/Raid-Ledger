/**
 * ROK-1837 D5/D10 — pure pan/zoom maths for the map viewport. The content is
 * a square of `content` texture pixels; `screen = texture · scale + (x, y)`.
 * Zoom is clamped to `[fit, MAX_NATIVE_SCALE]` and pan so the map never
 * leaves the viewport (it centres on an axis where it is smaller).
 */

export const MAX_NATIVE_SCALE = 8;
export const KEY_ZOOM_FACTOR = 1.25;
export const KEY_PAN_PX = 64;

export interface Point {
    x: number;
    y: number;
}
export interface Size {
    width: number;
    height: number;
}
export interface Viewport {
    scale: number;
    x: number;
    y: number;
}
export interface ViewportState {
    view: Size;
    content: number;
    vp: Viewport;
}

export type ViewportAction =
    | { type: 'resize'; view: Size }
    | { type: 'pan'; dx: number; dy: number }
    | { type: 'zoomBy'; factor: number; anchor?: Point }
    | { type: 'pinch'; before: PinchGeometry; after: PinchGeometry }
    | { type: 'fit' };

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Largest scale at which the whole `content`² square fits `view`. */
export function fitScale(view: Size, content: number): number {
    if (content <= 0 || view.width <= 0 || view.height <= 0) return 1;
    return Math.min(view.width / content, view.height / content);
}

/** Scale `vp` to `nextScale` keeping the texture point under `anchor` fixed. */
export function zoomAbout(
    vp: Viewport,
    anchor: Point,
    nextScale: number,
): Viewport {
    const ratio = nextScale / vp.scale;
    return {
        scale: nextScale,
        x: anchor.x - (anchor.x - vp.x) * ratio,
        y: anchor.y - (anchor.y - vp.y) * ratio,
    };
}

function clampAxis(
    offset: number,
    viewLen: number,
    contentLen: number,
): number {
    if (contentLen <= viewLen) return (viewLen - contentLen) / 2;
    return clamp(offset, viewLen - contentLen, 0);
}

/** Clamp scale to `[fit, MAX_NATIVE_SCALE]` and pan to the bounds. */
export function clampViewport(
    vp: Viewport,
    view: Size,
    content: number,
): Viewport {
    const min = fitScale(view, content);
    const scale = clamp(vp.scale, min, Math.max(min, MAX_NATIVE_SCALE));
    const size = content * scale;
    return {
        scale,
        x: clampAxis(vp.x, view.width, size),
        y: clampAxis(vp.y, view.height, size),
    };
}

/** The whole map, centred. */
export function fitViewport(view: Size, content: number): Viewport {
    return clampViewport(
        { scale: fitScale(view, content), x: 0, y: 0 },
        view,
        content,
    );
}

const centreOf = (view: Size): Point => ({
    x: view.width / 2,
    y: view.height / 2,
});

function panBy(state: ViewportState, dx: number, dy: number): Viewport {
    const { vp, view, content } = state;
    return clampViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, view, content);
}

function zoomBy(
    state: ViewportState,
    factor: number,
    anchor?: Point,
): Viewport {
    const { vp, view, content } = state;
    const min = fitScale(view, content);
    const next = clamp(vp.scale * factor, min, Math.max(min, MAX_NATIVE_SCALE));
    return clampViewport(
        zoomAbout(vp, anchor ?? centreOf(view), next),
        view,
        content,
    );
}

const SCALE_EPSILON = 1e-6;

/**
 * A resize refits only when the map was at fit scale (or not yet measured);
 * otherwise it keeps the user's zoom and the texture point at the centre —
 * a phone's `dvh` frame resizes whenever the URL bar shows or hides.
 */
function resizeVp(state: ViewportState, next: Size): Viewport {
    const { vp, view, content } = state;
    const atFit = Math.abs(vp.scale - fitScale(view, content)) < SCALE_EPSILON;
    if (view.width <= 0 || view.height <= 0 || atFit)
        return fitViewport(next, content);
    const dx = (next.width - view.width) / 2;
    const dy = (next.height - view.height) / 2;
    return clampViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, next, content);
}

/** Two-finger pinch geometry: the pointers' midpoint and distance. */
export interface PinchGeometry {
    mid: Point;
    dist: number;
}

/**
 * One pinch step: zoom about the PREVIOUS midpoint (where the fingers held
 * the texture), then pan by the midpoint's travel — composed, then clamped
 * ONCE so an edge clamp on the intermediate zoom cannot drift the result.
 */
function pinchVp(
    state: ViewportState,
    before: PinchGeometry,
    after: PinchGeometry,
): Viewport {
    const { vp, view, content } = state;
    if (before.dist === 0) return vp;
    const min = fitScale(view, content);
    const scale = clamp(
        vp.scale * (after.dist / before.dist),
        min,
        Math.max(min, MAX_NATIVE_SCALE),
    );
    const zoomed = zoomAbout(vp, before.mid, scale);
    const x = zoomed.x + after.mid.x - before.mid.x;
    const y = zoomed.y + after.mid.y - before.mid.y;
    return clampViewport({ scale, x, y }, view, content);
}

/** The single atomic action for one pinch step. */
export function pinchActions(
    before: PinchGeometry,
    after: PinchGeometry,
): ViewportAction[] {
    if (before.dist === 0) return [];
    return [{ type: 'pinch', before, after }];
}

export function viewportReducer(
    state: ViewportState,
    action: ViewportAction,
): ViewportState {
    const { view, content } = state;
    switch (action.type) {
        case 'resize':
            return {
                ...state,
                view: action.view,
                vp: resizeVp(state, action.view),
            };
        case 'fit':
            return { ...state, vp: fitViewport(view, content) };
        case 'pan':
            return { ...state, vp: panBy(state, action.dx, action.dy) };
        case 'zoomBy':
            return {
                ...state,
                vp: zoomBy(state, action.factor, action.anchor),
            };
        case 'pinch':
            return {
                ...state,
                vp: pinchVp(state, action.before, action.after),
            };
    }
}

export function initViewport(
    content: number,
    view: Size = { width: 0, height: 0 },
): ViewportState {
    return { view, content, vp: fitViewport(view, content) };
}

/** Keyboard (D9): arrows pan, `+`/`=` and `-` zoom about the centre, `0` fits. */
export function keyToAction(key: string): ViewportAction | null {
    switch (key) {
        case '+':
        case '=':
            return { type: 'zoomBy', factor: KEY_ZOOM_FACTOR };
        case '-':
        case '_':
            return { type: 'zoomBy', factor: 1 / KEY_ZOOM_FACTOR };
        case '0':
            return { type: 'fit' };
        case 'ArrowLeft':
            return { type: 'pan', dx: KEY_PAN_PX, dy: 0 };
        case 'ArrowRight':
            return { type: 'pan', dx: -KEY_PAN_PX, dy: 0 };
        case 'ArrowUp':
            return { type: 'pan', dx: 0, dy: KEY_PAN_PX };
        case 'ArrowDown':
            return { type: 'pan', dx: 0, dy: -KEY_PAN_PX };
        default:
            return null;
    }
}
