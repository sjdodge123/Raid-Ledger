/** ROK-1641 review NIT: `dvh` support is probed once, safely, at module load. */
import { describe, it, expect, vi, afterEach } from 'vitest';

async function probe(css: unknown): Promise<boolean> {
    vi.resetModules();
    vi.stubGlobal('CSS', css);
    return (await import('./bottom-sheet-viewport')).SUPPORTS_DVH;
}

describe('SUPPORTS_DVH', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('is false (and does not throw) when CSS is missing, as under SSR', async () => {
        expect(await probe(undefined)).toBe(false);
    });

    it('is false when CSS.supports is missing, as in jsdom', async () => {
        expect(await probe({})).toBe(false);
    });

    it('asks CSS.supports for dvh exactly once, however many sheets render', async () => {
        const supports = vi.fn(() => true);
        expect(await probe({ supports })).toBe(true);
        const again = await import('./bottom-sheet-viewport');
        expect(again.toDynamicViewport('60vh', again.SUPPORTS_DVH)).toBe('60dvh');
        expect(again.toDynamicViewport('95vh', again.SUPPORTS_DVH)).toBe('95dvh');
        expect(supports).toHaveBeenCalledTimes(1);
        expect(supports).toHaveBeenCalledWith('height', '1dvh');
    });
});
