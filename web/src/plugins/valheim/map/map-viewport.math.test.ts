import { describe, expect, it } from 'vitest';
import {
    MAX_NATIVE_SCALE,
    clamp,
    clampViewport,
    fitScale,
    fitViewport,
    initViewport,
    keyToAction,
    viewportReducer,
    zoomAbout,
    type Viewport,
} from './map-viewport.math';

const phone = { width: 375, height: 600 };
const desktop = { width: 1440, height: 720 };
const toTexture = (vp: Viewport, p: { x: number; y: number }) => ({ x: (p.x - vp.x) / vp.scale, y: (p.y - vp.y) / vp.scale });

describe('clamp / fitScale', () => {
    it('clamps into the range', () => {
        expect([clamp(-1, 0, 5), clamp(3, 0, 5), clamp(9, 0, 5)]).toEqual([0, 3, 5]);
    });

    it('fits a 2048 map on a 375×600 phone by its width and centres it vertically', () => {
        expect(fitScale(phone, 2048)).toBeCloseTo(375 / 2048, 10);
        const vp = fitViewport(phone, 2048);
        expect(vp.x).toBe(0);
        expect(vp.y).toBeCloseTo((600 - 375) / 2, 6);
    });

    it('fits a 2048 map on a 1440×720 desktop by its height and centres it horizontally', () => {
        const vp = fitViewport(desktop, 2048);
        expect(vp.scale).toBeCloseTo(720 / 2048, 10);
        expect(vp.x).toBeCloseTo((1440 - 720) / 2, 6);
        expect(vp.y).toBe(0);
    });
});

describe('zoomAbout', () => {
    it('keeps the texture point under the anchor fixed', () => {
        const vp = { scale: 0.5, x: 30, y: -40 };
        const anchor = { x: 200, y: 150 };
        const next = zoomAbout(vp, anchor, 2);
        expect(toTexture(next, anchor).x).toBeCloseTo(toTexture(vp, anchor).x, 9);
        expect(toTexture(next, anchor).y).toBeCloseTo(toTexture(vp, anchor).y, 9);
        expect(next.scale).toBe(2);
    });
});

describe('clampViewport', () => {
    it('stops a pan from dragging the map out of view', () => {
        const vp = clampViewport({ scale: 1, x: 500, y: -5000 }, desktop, 2048);
        expect(vp).toEqual({ scale: 1, x: 0, y: 720 - 2048 });
    });

    it('never zooms below fit or above 8× native', () => {
        expect(clampViewport({ scale: 0.01, x: 0, y: 0 }, desktop, 2048).scale).toBeCloseTo(720 / 2048, 10);
        expect(clampViewport({ scale: 50, x: 0, y: 0 }, desktop, 2048).scale).toBe(MAX_NATIVE_SCALE);
    });
});

describe('viewportReducer', () => {
    const start = initViewport(2048, desktop);

    it('zooms about the anchor and clamps at the max', () => {
        const anchor = { x: 720, y: 360 };
        const z = viewportReducer(start, { type: 'zoomBy', factor: 2, anchor });
        expect(z.vp.scale).toBeCloseTo((720 / 2048) * 2, 10);
        expect(toTexture(z.vp, anchor).x).toBeCloseTo(1024, 6);
        const maxed = viewportReducer(z, { type: 'zoomBy', factor: 1000 });
        expect(maxed.vp.scale).toBe(MAX_NATIVE_SCALE);
    });

    it('pans when zoomed in, and fit restores the initial viewport', () => {
        const z = viewportReducer(start, { type: 'zoomBy', factor: 4 });
        const panned = viewportReducer(z, { type: 'pan', dx: 40, dy: -25 });
        expect(panned.vp.x).toBeCloseTo(z.vp.x + 40, 6);
        expect(panned.vp.y).toBeCloseTo(z.vp.y - 25, 6);
        expect(viewportReducer(panned, { type: 'fit' }).vp).toEqual(start.vp);
    });

    it('re-fits on resize', () => {
        const resized = viewportReducer(start, { type: 'resize', view: phone });
        expect(resized.view).toEqual(phone);
        expect(resized.vp).toEqual(fitViewport(phone, 2048));
    });

    it('maps keys to actions', () => {
        expect(keyToAction('+')).toEqual({ type: 'zoomBy', factor: 1.25 });
        expect(keyToAction('0')).toEqual({ type: 'fit' });
        expect(keyToAction('ArrowLeft')).toEqual({ type: 'pan', dx: 64, dy: 0 });
        expect(keyToAction('a')).toBeNull();
    });
});
