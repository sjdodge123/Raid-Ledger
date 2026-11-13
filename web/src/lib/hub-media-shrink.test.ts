import { describe, it, expect, vi } from 'vitest';
import { mayHaveAlpha, paintForEncode, type ShrinkDrawContext } from './hub-media-shrink';

describe('mayHaveAlpha', () => {
    it('treats PNG and WebP as possibly transparent and JPEG as opaque', () => {
        expect(mayHaveAlpha(new File(['a'], 'a.png', { type: 'image/png' }))).toBe(true);
        expect(mayHaveAlpha(new File(['a'], 'a.webp', { type: 'image/webp' }))).toBe(true);
        expect(mayHaveAlpha(new File(['a'], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
    });
});

/** A recording 2D context: each call appends `name:fillStyle-at-call-time`. */
function recordingContext(): { ctx: ShrinkDrawContext; calls: string[] } {
    const calls: string[] = [];
    const ctx: ShrinkDrawContext = {
        fillStyle: '',
        fillRect: vi.fn(() => { calls.push(`fillRect:${String(ctx.fillStyle)}`); }),
        drawImage: vi.fn(() => { calls.push('drawImage'); }),
    };
    return { ctx, calls };
}

describe('paintForEncode', () => {
    it('mattes the canvas white before drawing when the output is JPEG, so transparent pixels are not black', () => {
        const { ctx, calls } = recordingContext();
        paintForEncode(ctx, document.createElement('canvas'), 40, 30, 'image/jpeg');
        expect(calls).toEqual(['fillRect:#ffffff', 'drawImage']);
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 40, 30);
    });

    it('draws without a matte when the output is WebP, which keeps the alpha channel', () => {
        const { ctx, calls } = recordingContext();
        paintForEncode(ctx, document.createElement('canvas'), 40, 30, 'image/webp');
        expect(calls).toEqual(['drawImage']);
    });
});
