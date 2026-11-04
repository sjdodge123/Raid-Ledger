import { describe, expect, it } from 'vitest';
import {
    GALLERY_WHEEL_MAX_PX, GALLERY_ZOOM_MAX, INITIAL_ZOOM_STATE, type ZoomState, clampZoomState, isAtFit, isDoubleTap, pinchGeometry,
    swipeDirection, wheelDeltaPx, wheelZoomFactor, zoomReducer,
} from './gallery-zoom.math';

/** A 400×300 stage holding a picture laid out at 400×225 (16:9 fit). */
const MEASURED: ZoomState = { ...INITIAL_ZOOM_STATE, view: { width: 400, height: 300 }, fit: { width: 400, height: 225 } };

describe('gallery zoom maths (ROK-2075)', () => {
    it('clamps zoom to [1, max]', () => {
        expect(clampZoomState({ ...MEASURED, zoom: 0.5 }).zoom).toBe(1);
        expect(clampZoomState({ ...MEASURED, zoom: 99 }).zoom).toBe(GALLERY_ZOOM_MAX);
    });

    it('keeps the picture centred at fit — a drag at fit moves nothing', () => {
        const s = zoomReducer(MEASURED, { type: 'pan', dx: 120, dy: -80 });
        expect({ x: s.x, y: s.y }).toEqual({ x: 0, y: 0 });
    });

    it('clamps a pan to the overflow so the picture never leaves the stage', () => {
        // At 2×: 800×450 in 400×300 → x within ±200, y within ±75.
        const zoomed = { ...MEASURED, zoom: 2 };
        const s = zoomReducer(zoomed, { type: 'pan', dx: 1000, dy: -1000 });
        expect({ x: s.x, y: s.y }).toEqual({ x: 200, y: -75 });
    });

    it('keeps an axis centred while the picture is still smaller than the stage on it', () => {
        // At 1.2×: height 270 < 300 → y stays 0; width 480 > 400 → x within ±40.
        const s = zoomReducer({ ...MEASURED, zoom: 1.2 }, { type: 'pan', dx: 500, dy: 500 });
        expect({ x: s.x, y: s.y }).toEqual({ x: 40, y: 0 });
    });

    it('zooms about the anchor: the point under it stays put', () => {
        const anchor = { x: 100, y: 50 };
        const s = zoomReducer(MEASURED, { type: 'zoomBy', factor: 2, anchor });
        // picture point under the anchor before: (anchor - t) / zoom = (100, 50); after: zoom·p + t must equal the anchor.
        expect(s.zoom).toBe(2);
        expect({ x: 2 * 100 + s.x, y: 2 * 50 + s.y }).toEqual(anchor);
    });

    it('toggles fit ↔ 2× and animates the step', () => {
        const zoomed = zoomReducer(MEASURED, { type: 'toggle' });
        expect(zoomed).toMatchObject({ zoom: 2, animate: true });
        expect(zoomReducer(zoomed, { type: 'toggle' })).toMatchObject({ zoom: 1, x: 0, y: 0, animate: true });
    });

    it('pinches by the finger-distance ratio, capped at max', () => {
        const before = pinchGeometry({ x: -50, y: 0 }, { x: 50, y: 0 });
        const after = pinchGeometry({ x: -100, y: 0 }, { x: 100, y: 0 });
        expect(zoomReducer(MEASURED, { type: 'pinch', before, after }).zoom).toBe(2);
        const huge = pinchGeometry({ x: -1000, y: 0 }, { x: 1000, y: 0 });
        expect(zoomReducer(MEASURED, { type: 'pinch', before, after: huge }).zoom).toBe(GALLERY_ZOOM_MAX);
    });

    it('ignores a degenerate pinch (zero distance)', () => {
        const zero = pinchGeometry({ x: 5, y: 5 }, { x: 5, y: 5 });
        expect(zoomReducer(MEASURED, { type: 'pinch', before: zero, after: zero })).toEqual({ ...MEASURED, animate: false });
    });

    it('settles a gesture that ends barely zoomed back to fit, and leaves a real zoom alone', () => {
        expect(zoomReducer({ ...MEASURED, zoom: 1.03, x: 4 }, { type: 'settle' })).toMatchObject({ zoom: 1, x: 0 });
        expect(zoomReducer({ ...MEASURED, zoom: 1.6 }, { type: 'settle' }).zoom).toBe(1.6);
    });

    it('announces discrete steps and settles, never a pinch or wheel frame', () => {
        const wheeled = zoomReducer(MEASURED, { type: 'zoomBy', factor: 1.2 });
        expect(wheeled).toMatchObject({ zoom: 1.2, announced: 1 });
        expect(zoomReducer(wheeled, { type: 'settle' }).announced).toBe(1.2);
        expect(zoomReducer(MEASURED, { type: 'zoomBy', factor: 1.5, animate: true }).announced).toBe(1.5);
    });

    it('returns the same state object when nothing changed (a drag at fit), so React skips the render', () => {
        expect(zoomReducer(MEASURED, { type: 'pan', dx: 40, dy: 10 })).toBe(MEASURED);
    });

    it('fit resets zoom and offset', () => {
        expect(zoomReducer({ ...MEASURED, zoom: 3, x: 90, y: -40 }, { type: 'fit' })).toMatchObject({ zoom: 1, x: 0, y: 0 });
        expect(zoomReducer({ ...MEASURED, zoom: 3, x: 90, animate: true }, { type: 'reset' }), 'a new picture never animates').toMatchObject({ zoom: 1, x: 0, animate: false });
    });

    it('a re-measure keeps the zoom and re-clamps the offset to the new stage', () => {
        const s = zoomReducer({ ...MEASURED, zoom: 2, x: 200 }, { type: 'measure', view: { width: 600, height: 300 }, fit: { width: 400, height: 225 } });
        expect({ zoom: s.zoom, x: s.x }).toEqual({ zoom: 2, x: 100 });
    });

    it('reports fit', () => {
        expect(isAtFit({ zoom: 1 })).toBe(true);
        expect(isAtFit({ zoom: 1.5 })).toBe(false);
    });
});

describe('gallery zoom input rules (ROK-2075)', () => {
    it('normalises wheel deltas: pixels, lines, pages', () => {
        expect(wheelDeltaPx(3, 0, 500)).toBe(3);
        expect(wheelDeltaPx(3, 1, 500)).toBe(48);
        expect(wheelDeltaPx(1, 2, 500)).toBe(500);
    });

    it('wheel up zooms in, wheel down zooms out, and a big notch is capped', () => {
        expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
        expect(wheelZoomFactor(10)).toBeLessThan(1);
        expect(wheelZoomFactor(-1000)).toBe(wheelZoomFactor(-GALLERY_WHEEL_MAX_PX));
    });

    it('a swipe is a mostly-horizontal drag of at least 48px; left = next', () => {
        expect(swipeDirection(-60, 5)).toBe('next');
        expect(swipeDirection(60, 5)).toBe('prev');
        expect(swipeDirection(30, 0)).toBeNull();
        expect(swipeDirection(60, 50)).toBeNull();
    });

    it('two taps within 300ms and 30px are a double-tap', () => {
        const first = { time: 1000, point: { x: 0, y: 0 } };
        expect(isDoubleTap(first, 1250, { x: 10, y: 10 })).toBe(true);
        expect(isDoubleTap(first, 1400, { x: 0, y: 0 })).toBe(false);
        expect(isDoubleTap(first, 1100, { x: 50, y: 0 })).toBe(false);
        expect(isDoubleTap(null, 1100, { x: 0, y: 0 })).toBe(false);
    });
});
