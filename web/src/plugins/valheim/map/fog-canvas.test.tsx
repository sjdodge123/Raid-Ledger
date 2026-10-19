import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { FogCanvas } from './fog-canvas';
import { parseCssRgb } from './fog-theme';
import { FOG_ALPHA_SHARED_ONLY, FOG_ALPHA_UNEXPLORED } from './fog-bitmap';

const SIZE = 8;
const BYTES = (SIZE * SIZE) / 8;

interface FakeImage {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

let put: ReturnType<typeof vi.fn>;
let painted: FakeImage[] = [];
/** The theme's `--color-backdrop` as getComputedStyle reports it. */
let backdrop = '#102030';

function bits(set: number[]): Uint8Array {
    const out = new Uint8Array(BYTES);
    for (const i of set) out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
    return out;
}

/** Alpha at texture (px, py) — canvas row 0 is north. */
function alphaAt(img: FakeImage | undefined, px: number, py: number): number {
    if (!img) throw new Error('nothing painted');
    return img.data[((SIZE - 1 - py) * SIZE + px) * 4 + 3] ?? -1;
}

beforeEach(() => {
    painted = [];
    put = vi.fn((img: FakeImage) => void painted.push(img));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () =>
            ({
                createImageData: (w: number, h: number): FakeImage => ({
                    data: new Uint8ClampedArray(w * h * 4),
                    width: w,
                    height: h,
                }),
                putImageData: put,
            }) as unknown as CanvasRenderingContext2D,
    );
    backdrop = '#102030';
    // Only a class / data-theme change may trigger the re-read (not a style write).
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
        const decl = document.createElement('div').style;
        decl.setProperty('--color-backdrop', backdrop);
        return decl;
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.className = '';
});

describe('parseCssRgb', () => {
    it('reads hex and rgb() forms', () => {
        expect(parseCssRgb('#102030')).toEqual({ r: 16, g: 32, b: 48 });
        expect(parseCssRgb(' #fff ')).toEqual({ r: 255, g: 255, b: 255 });
        expect(parseCssRgb('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
        expect(parseCssRgb('nonsense')).toBeNull();
    });
});

describe('FogCanvas (ROK-1837 D7)', () => {
    const personal = bits([0]);
    const shared = bits([0, 1]);

    it('sizes the canvas to the texture and hides it from AT', () => {
        const { container } = render(
            <FogCanvas size={SIZE} personal={personal} shared={null} />,
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(SIZE);
        expect(canvas?.height).toBe(SIZE);
        expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    });

    it('paints explored 0, shared-only 0.45, unexplored 0.92 in the theme colour', () => {
        render(<FogCanvas size={SIZE} personal={personal} shared={shared} />);
        const img = painted.at(-1);
        expect(alphaAt(img, 0, 0)).toBe(0);
        expect(alphaAt(img, 1, 0)).toBe(
            Math.round(FOG_ALPHA_SHARED_ONLY * 255),
        );
        expect(alphaAt(img, 2, 0)).toBe(Math.round(FOG_ALPHA_UNEXPLORED * 255));
        expect(Array.from(img?.data.slice(0, 3) ?? [])).toEqual([16, 32, 48]);
    });

    it('with the shared layer off, shared-only pixels stay fully fogged', () => {
        render(<FogCanvas size={SIZE} personal={personal} shared={null} />);
        expect(alphaAt(painted.at(-1), 1, 0)).toBe(
            Math.round(FOG_ALPHA_UNEXPLORED * 255),
        );
    });

    it('does not repaint when re-rendered with the same layers (pan/zoom)', () => {
        const { rerender } = render(
            <FogCanvas size={SIZE} personal={personal} shared={null} />,
        );
        rerender(<FogCanvas size={SIZE} personal={personal} shared={null} />);
        expect(put).toHaveBeenCalledTimes(1);
    });

    it('repaints in the new colour when the theme class changes', async () => {
        render(<FogCanvas size={SIZE} personal={personal} shared={null} />);
        backdrop = '#f8fafc';
        await act(async () => {
            document.documentElement.className = 'theme-light';
            await Promise.resolve();
        });
        expect(put).toHaveBeenCalledTimes(2);
        expect(Array.from(painted.at(-1)?.data.slice(0, 3) ?? [])).toEqual([
            248, 250, 252,
        ]);
    });
});
