import { describe, expect, it } from 'vitest';
import {
    MAX_NATIVE_SCALE,
    clamp,
    clampViewport,
    fitScale,
    fitViewport,
    initViewport,
    keyToAction,
    pinchActions,
    viewportReducer,
    zoomAbout,
    type Viewport,
} from './map-viewport.math';

const phone = { width: 375, height: 600 };
const desktop = { width: 1440, height: 720 };
const toTexture = (vp: Viewport, p: { x: number; y: number }) => ({
    x: (p.x - vp.x) / vp.scale,
    y: (p.y - vp.y) / vp.scale,
});

describe('clamp / fitScale', () => {
    it('clamps into the range', () => {
        expect([clamp(-1, 0, 5), clamp(3, 0, 5), clamp(9, 0, 5)]).toEqual([
            0, 3, 5,
        ]);
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
        expect(toTexture(next, anchor).x).toBeCloseTo(
            toTexture(vp, anchor).x,
            9,
        );
        expect(toTexture(next, anchor).y).toBeCloseTo(
            toTexture(vp, anchor).y,
            9,
        );
        expect(next.scale).toBe(2);
    });
});

describe('clampViewport', () => {
    it('stops a pan from dragging the map out of view', () => {
        const vp = clampViewport({ scale: 1, x: 500, y: -5000 }, desktop, 2048);
        expect(vp).toEqual({ scale: 1, x: 0, y: 720 - 2048 });
    });

    it('never zooms below fit or above 8× native', () => {
        expect(
            clampViewport({ scale: 0.01, x: 0, y: 0 }, desktop, 2048).scale,
        ).toBeCloseTo(720 / 2048, 10);
        expect(
            clampViewport({ scale: 50, x: 0, y: 0 }, desktop, 2048).scale,
        ).toBe(MAX_NATIVE_SCALE);
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

    it('keeps a zoomed-in scale on resize and re-clamps (phone URL bar, MAJOR 2)', () => {
        const sized = viewportReducer(start, { type: 'resize', view: phone });
        const zoomed = viewportReducer(sized, { type: 'zoomBy', factor: 4 });
        const taller = { width: 375, height: 660 };
        const resized = viewportReducer(zoomed, {
            type: 'resize',
            view: taller,
        });
        expect(resized.vp.scale).toBeCloseTo(zoomed.vp.scale, 10);
        expect(resized.vp).toEqual(clampViewport(resized.vp, taller, 2048));
        const centre = toTexture(resized.vp, { x: 375 / 2, y: 330 });
        const was = toTexture(zoomed.vp, { x: 375 / 2, y: 300 });
        expect(centre.x).toBeCloseTo(was.x, 6);
        expect(centre.y).toBeCloseTo(was.y, 6);
    });

    it('still re-fits on resize while at fit scale', () => {
        const sized = viewportReducer(start, { type: 'resize', view: phone });
        const taller = { width: 375, height: 660 };
        const resized = viewportReducer(sized, { type: 'resize', view: taller });
        expect(resized.vp).toEqual(fitViewport(taller, 2048));
    });

    it('re-fits on resize', () => {
        const resized = viewportReducer(start, { type: 'resize', view: phone });
        expect(resized.view).toEqual(phone);
        expect(resized.vp).toEqual(fitViewport(phone, 2048));
    });

    it('a pinch keeps the texture point under the fingers fixed as the midpoint moves', () => {
        let state = viewportReducer(start, { type: 'resize', view: desktop });
        state = viewportReducer(state, { type: 'zoomBy', factor: 3 });
        const before = { mid: { x: 700, y: 360 }, dist: 100 };
        const after = { mid: { x: 760, y: 400 }, dist: 150 };
        const held = toTexture(state.vp, before.mid);
        for (const a of pinchActions(before, after))
            state = viewportReducer(state, a);
        const under = toTexture(state.vp, after.mid);
        expect(under.x).toBeCloseTo(held.x, 6);
        expect(under.y).toBeCloseTo(held.y, 6);
    });

    it('maps keys to actions', () => {
        expect(keyToAction('+')).toEqual({ type: 'zoomBy', factor: 1.25 });
        expect(keyToAction('0')).toEqual({ type: 'fit' });
        expect(keyToAction('ArrowLeft')).toEqual({
            type: 'pan',
            dx: 64,
            dy: 0,
        });
        expect(keyToAction('a')).toBeNull();
    });
});
