import { describe, expect, it } from 'vitest';
import {
    CENTRE_FIT_MULTIPLE,
    fitScale,
    initViewport,
    viewportReducer,
} from './map-viewport.math';

const VIEW = { width: 400, height: 300 };

describe('viewport centre (ROK-1889)', () => {
    it('puts the texture point at the view centre, zoomed in', () => {
        const s0 = initViewport(1024, VIEW);
        const s = viewportReducer(s0, {
            type: 'centre',
            point: { x: 512, y: 600 },
        });
        const scale = fitScale(VIEW, 1024) * CENTRE_FIT_MULTIPLE;
        expect(s.vp.scale).toBeCloseTo(scale);
        expect(s.vp.x + 512 * scale).toBeCloseTo(200);
        expect(s.vp.y + 600 * scale).toBeCloseTo(150);
    });

    it('holds a centre requested before the first measure until the resize', () => {
        const s0 = initViewport(1024);
        const held = viewportReducer(s0, {
            type: 'centre',
            point: { x: 512, y: 512 },
        });
        expect(held.pending).toEqual({ x: 512, y: 512 });
        const s = viewportReducer(held, { type: 'resize', view: VIEW });
        expect(s.pending).toBeUndefined();
        expect(s.vp.x + 512 * s.vp.scale).toBeCloseTo(200);
    });
});
