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

export function viewportReducer(
    state: ViewportState,
    action: ViewportAction,
): ViewportState {
    const { view, content, vp } = state;
    switch (action.type) {
        case 'resize':
            return {
                ...state,
                view: action.view,
                vp: fitViewport(action.view, content),
            };
        case 'fit':
            return { ...state, vp: fitViewport(view, content) };
        case 'pan':
            return {
                ...state,
                vp: clampViewport(
                    { ...vp, x: vp.x + action.dx, y: vp.y + action.dy },
                    view,
                    content,
                ),
            };
        case 'zoomBy': {
            const min = fitScale(view, content);
            const next = clamp(
                vp.scale * action.factor,
                min,
                Math.max(min, MAX_NATIVE_SCALE),
            );
            return {
                ...state,
                vp: clampViewport(
                    zoomAbout(vp, action.anchor ?? centreOf(view), next),
                    view,
                    content,
                ),
            };
        }
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
