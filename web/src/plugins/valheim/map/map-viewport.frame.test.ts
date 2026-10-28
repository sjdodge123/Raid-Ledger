/**
 * ROK-2028 — the map opens framed on the explored area: `frameViewport`
 * (bounds → scale/translate), the reducer's `frame` action and Fit, and the
 * fog bitset → explored-box scan that feeds them.
 */
import { describe, expect, it } from 'vitest';
import {
    FRAME_EMPTY_FIT_MULTIPLE,
    FRAME_MAX_SCALE,
    FRAME_PADDING,
    fitScale,
    fitViewport,
    frameViewport,
    initViewport,
    viewportReducer,
    type Bounds,
    type Viewport,
} from './map-viewport.math';
import { exploredBounds } from './fog-bitmap';

const desktop = { width: 1440, height: 720 };
const phone = { width: 375, height: 600 };
const WORLD = 2048;
/** The ROK-1837 fixture's explored square (texture px 904..1144). */
const EXPLORED: Bounds = { minX: 904, minY: 904, maxX: 1144, maxY: 1144 };

const centreOnScreen = (vp: Viewport, b: Bounds) => ({
    x: ((b.minX + b.maxX) / 2) * vp.scale + vp.x,
    y: ((b.minY + b.maxY) / 2) * vp.scale + vp.y,
});

describe('frameViewport (ROK-2028)', () => {
    it('without a frame it is the whole-world fit, as before', () => {
        expect(frameViewport(desktop, WORLD, undefined)).toEqual(fitViewport(desktop, WORLD));
    });

    it('before the surface is measured it falls back to the fit', () => {
        const unmeasured = { width: 0, height: 0 };
        expect(frameViewport(unmeasured, WORLD, EXPLORED)).toEqual(fitViewport(unmeasured, WORLD));
    });

    it('fills the view with the explored box plus padding, centred on it', () => {
        const vp = frameViewport(desktop, WORLD, EXPLORED);
        const span = 240 * (1 + 2 * FRAME_PADDING);
        expect(vp.scale).toBeCloseTo(desktop.height / span, 6);
        expect(vp.scale).toBeGreaterThan(fitScale(desktop, WORLD) * 4);
        const c = centreOnScreen(vp, EXPLORED);
        expect(c.x).toBeCloseTo(desktop.width / 2, 6);
        expect(c.y).toBeCloseTo(desktop.height / 2, 6);
    });

    it('frames by the narrow axis on a phone', () => {
        const vp = frameViewport(phone, WORLD, EXPLORED);
        expect(vp.scale).toBeCloseTo(phone.width / (240 * (1 + 2 * FRAME_PADDING)), 6);
    });

    it('nothing explored → a moderate zoom on the world centre', () => {
        const vp = frameViewport(desktop, WORLD, null);
        expect(vp.scale).toBeCloseTo(fitScale(desktop, WORLD) * FRAME_EMPTY_FIT_MULTIPLE, 6);
        const world: Bounds = { minX: 0, minY: 0, maxX: WORLD, maxY: WORLD };
        expect(centreOnScreen(vp, world).x).toBeCloseTo(desktop.width / 2, 6);
        expect(centreOnScreen(vp, world).y).toBeCloseTo(desktop.height / 2, 6);
    });

    it('a few explored pixels never zoom past FRAME_MAX_SCALE', () => {
        const dot: Bounds = { minX: 1000, minY: 1000, maxX: 1001, maxY: 1001 };
        expect(frameViewport(desktop, WORLD, dot).scale).toBe(FRAME_MAX_SCALE);
    });

    it('a box wider than the world clamps up to the whole-world fit', () => {
        const all: Bounds = { minX: 0, minY: 0, maxX: WORLD, maxY: WORLD };
        expect(frameViewport(desktop, WORLD, all)).toEqual(fitViewport(desktop, WORLD));
    });

    it('a box in a corner is pan-clamped so the map never leaves the view', () => {
        const corner: Bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
        const vp = frameViewport(desktop, WORLD, corner);
        expect(vp.x).toBe(0);
        expect(vp.y).toBe(0);
    });
});

describe('viewportReducer frame / fit (ROK-2028)', () => {
    const measured = () => viewportReducer(initViewport(WORLD), { type: 'resize', view: desktop });

    it('a frame re-frames an untouched map, and Fit returns to that framing', () => {
        const framed = viewportReducer(measured(), { type: 'frame', frame: EXPLORED });
        expect(framed.vp).toEqual(frameViewport(desktop, WORLD, EXPLORED));
        const zoomed = viewportReducer(framed, { type: 'zoomBy', factor: 1.5 });
        expect(zoomed.vp.scale).toBeGreaterThan(framed.vp.scale);
        expect(viewportReducer(zoomed, { type: 'fit' }).vp).toEqual(framed.vp);
    });

    it('a frame that lands after the user panned keeps their view', () => {
        const panned = viewportReducer(measured(), { type: 'pan', dx: 0, dy: 0 });
        const next = viewportReducer(panned, { type: 'frame', frame: EXPLORED });
        expect(next.vp).toEqual(panned.vp);
        expect(next.frame).toEqual(EXPLORED);
    });

    it('a chest centre is not overridden by a later frame', () => {
        const centred = viewportReducer(measured(), { type: 'centre', point: { x: 100, y: 100 } });
        expect(viewportReducer(centred, { type: 'frame', frame: EXPLORED }).vp).toEqual(centred.vp);
    });

    it('a resize before the user moves re-frames to the new size', () => {
        const framed = viewportReducer(measured(), { type: 'frame', frame: EXPLORED });
        const resized = viewportReducer(framed, { type: 'resize', view: phone });
        expect(resized.vp).toEqual(frameViewport(phone, WORLD, EXPLORED));
    });
});

describe('exploredBounds (ROK-2028)', () => {
    const SIZE = 16;
    const bits = (...set: [number, number][]) => {
        const out = new Uint8Array((SIZE * SIZE) / 8);
        for (const [px, py] of set) {
            const i = py * SIZE + px;
            out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
        }
        return out;
    };

    it('is null when nothing is explored', () => {
        expect(exploredBounds(SIZE, bits())).toBeNull();
    });

    it('flips py (south = 0) to canvas rows and makes max exclusive', () => {
        expect(exploredBounds(SIZE, bits([5, 0]))).toEqual({ minX: 5, maxX: 6, minY: 15, maxY: 16 });
    });

    it('spans every set bit', () => {
        expect(exploredBounds(SIZE, bits([2, 3], [9, 12], [4, 7]))).toEqual({
            minX: 2,
            maxX: 10,
            minY: 3,
            maxY: 13,
        });
    });
});
