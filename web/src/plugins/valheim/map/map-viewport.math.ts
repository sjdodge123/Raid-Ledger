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
    /** ROK-1889: a centre requested before the surface was measured. */
    pending?: Point;
    /** ROK-2028: what Fit frames — absent = the whole world, `null` = nothing explored. */
    frame?: Bounds | null;
    /** ROK-2028: the user panned/zoomed (or a chest centred) — a late frame keeps their view. */
    moved?: boolean;
}

/** ROK-2028: a texture-px box in canvas space (y down, north up); max is exclusive. */
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** ROK-2028: padding on every side of the framed box, as a fraction of its span. */
export const FRAME_PADDING = 0.15;
/** ROK-2028: smallest framed span (texture px) — a few explored pixels never zoom to max. */
export const FRAME_MIN_SPAN = 128;
/** ROK-2028: framing never zooms past this scale (screen px per texture px). */
export const FRAME_MAX_SCALE = 3;
/** ROK-2028: nothing explored → this multiple of the fit scale, centred on the world. */
export const FRAME_EMPTY_FIT_MULTIPLE = 2;

/** ROK-1889: a chest focus zooms to this multiple of the fit scale. */
export const CENTRE_FIT_MULTIPLE = 4;

export type ViewportAction =
    | { type: 'resize'; view: Size }
    | { type: 'pan'; dx: number; dy: number }
    | { type: 'zoomBy'; factor: number; anchor?: Point }
    | { type: 'pinch'; before: PinchGeometry; after: PinchGeometry }
    | { type: 'fit' }
    | { type: 'centre'; point: Point }
    | { type: 'frame'; frame: Bounds | null };

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
 * A resize re-frames while the user has not moved the map (ROK-2028) and
 * refits when it was at fit scale (or not yet measured);
 * otherwise it keeps the user's zoom and the texture point at the centre —
 * a phone's `dvh` frame resizes whenever the URL bar shows or hides.
 */
function resizeVp(state: ViewportState, next: Size): Viewport {
    const { vp, view, content, frame } = state;
    if (!state.moved || !measured(view)) return frameViewport(next, content, frame);
    const atFit = Math.abs(vp.scale - fitScale(view, content)) < SCALE_EPSILON;
    if (atFit) return fitViewport(next, content);
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

/** Texture point `p` at the view's centre at `scale` (clamped like every move). */
function scaledAbout(view: Size, content: number, scale: number, p: Point): Viewport {
    const min = fitScale(view, content);
    const s = clamp(scale, min, Math.max(min, MAX_NATIVE_SCALE));
    const vp = { scale: s, x: view.width / 2 - p.x * s, y: view.height / 2 - p.y * s };
    return clampViewport(vp, view, content);
}

/** Texture point `p` at the view's centre, zoomed in (clamped like every move). */
export function centreVp(state: ViewportState, p: Point): Viewport {
    const { view, content } = state;
    return scaledAbout(view, content, fitScale(view, content) * CENTRE_FIT_MULTIPLE, p);
}

const measured = (v: Size): boolean => v.width > 0 && v.height > 0;

const paddedSpan = (lo: number, hi: number): number =>
    Math.max(hi - lo, FRAME_MIN_SPAN) * (1 + 2 * FRAME_PADDING);

/**
 * ROK-2028: the view Fit returns to. `undefined` → the whole world (as
 * before); `null` (nothing explored) → a moderate zoom on the world's centre;
 * a box → it fills the view with {@link FRAME_PADDING}, never past
 * {@link FRAME_MAX_SCALE}, never below the world-fit scale.
 */
export function frameViewport(view: Size, content: number, frame: Bounds | null | undefined): Viewport {
    if (frame === undefined || !measured(view)) return fitViewport(view, content);
    const world = { x: content / 2, y: content / 2 };
    if (frame === null)
        return scaledAbout(view, content, fitScale(view, content) * FRAME_EMPTY_FIT_MULTIPLE, world);
    const scale = Math.min(
        view.width / paddedSpan(frame.minX, frame.maxX),
        view.height / paddedSpan(frame.minY, frame.maxY),
        FRAME_MAX_SCALE,
    );
    const centre = { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 };
    return scaledAbout(view, content, scale, centre);
}

function resizeState(state: ViewportState, view: Size): ViewportState {
    const { pending, ...rest } = state;
    const next = { ...rest, view, vp: resizeVp(state, view) };
    if (pending === undefined) return next;
    if (!measured(view)) return { ...next, pending };
    return { ...next, vp: centreVp(next, pending) };
}

/** ROK-2028: store what Fit frames; re-frame now unless the user already moved the map. */
function frameState(state: ViewportState, frame: Bounds | null): ViewportState {
    if (state.moved) return { ...state, frame };
    return { ...state, frame, vp: frameViewport(state.view, state.content, frame) };
}

export function viewportReducer(
    state: ViewportState,
    action: ViewportAction,
): ViewportState {
    const { view, content } = state;
    switch (action.type) {
        case 'resize':
            return resizeState(state, action.view);
        case 'centre':
            if (!measured(view)) return { ...state, moved: true, pending: action.point };
            return { ...state, moved: true, vp: centreVp(state, action.point) };
        case 'fit':
            return { ...state, moved: false, vp: frameViewport(view, content, state.frame) };
        case 'frame':
            return frameState(state, action.frame);
        case 'pan':
            return { ...state, moved: true, vp: panBy(state, action.dx, action.dy) };
        case 'zoomBy':
            return { ...state, moved: true, vp: zoomBy(state, action.factor, action.anchor) };
        case 'pinch':
            return { ...state, moved: true, vp: pinchVp(state, action.before, action.after) };
    }
}

export function initViewport(
    content: number,
    view: Size = { width: 0, height: 0 },
): ViewportState {
    return { view, content, vp: fitViewport(view, content) };
}

/** Keyboard (D9): arrows pan, `+`/`=` and `-` zoom about the centre, `0` fits (re-frames). */
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
