/**
 * Regression: ROK-1261 — ThemeParticles canvas must be clipped to the
 * document's content height so bright streaks/particles never render in
 * the empty zone below the footer when page content is shorter than the
 * viewport.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// Force the resolved theme to one with a CONFIGS entry ('arctic'), otherwise
// ThemeParticles short-circuits to null on themes without an ambient config.
vi.mock('../../stores/theme-store', () => ({
    useThemeStore: (selector: (s: { resolved: { id: string } }) => unknown) =>
        selector({ resolved: { id: 'arctic' } }),
}));

import { ThemeParticles } from './ThemeParticles';

function setDimensions(viewportH: number, documentH: number) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewportH);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(documentH);
}

function stubCanvasContext() {
    // jsdom does not implement 2D canvas. Return a minimal stub so setupCanvas
    // proceeds and sizes the bitmap; the regression we care about is purely
    // about width/height attributes, not drawing.
    const ctx = new Proxy({}, {
        get: () => () => undefined,
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
}

describe('Regression: ROK-1261 — ThemeParticles canvas clip', () => {
    beforeEach(() => {
        stubCanvasContext();
        // Default matchMedia mock returns matches: false for reduced-motion so
        // the animation effect runs and sizes the canvas.
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('caps canvas height to document height when content is shorter than viewport', () => {
        // Viewport is 900px tall but page content is only 600px — without the
        // fix, particles would draw in the empty 600-900 zone below the footer.
        setDimensions(900, 600);

        const { container } = render(<ThemeParticles />);
        const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
        expect(canvas).not.toBeNull();
        expect(canvas!.height).toBe(600);
        expect(canvas!.height).toBeLessThanOrEqual(document.documentElement.scrollHeight);
    });

    it('uses viewport height when document is taller (long-content page)', () => {
        // Long-content page — canvas should still cover the visible viewport
        // on first paint; particles drawing above scrollHeight is fine because
        // they remain inside the viewport bitmap.
        setDimensions(900, 3000);

        const { container } = render(<ThemeParticles />);
        const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
        expect(canvas).not.toBeNull();
        expect(canvas!.height).toBe(900);
    });

    it('sets canvas CSS height to match the bitmap height (prevents stretch)', () => {
        // Without an explicit CSS height the prior `inset: 0` rule stretched the
        // canvas to the full viewport regardless of its bitmap, re-introducing
        // the streaks below content. Verify the inline style is set in px.
        setDimensions(900, 500);

        const { container } = render(<ThemeParticles />);
        const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
        expect(canvas).not.toBeNull();
        expect(canvas!.style.height).toBe('500px');
    });

    it('does not pin the canvas bottom to the viewport (would re-stretch via CSS)', () => {
        // With `inset: 0` (top:0; right:0; bottom:0; left:0) the canvas always
        // fills the viewport regardless of its bitmap height. The fix removes
        // the bottom anchor and drives height from the bitmap instead.
        setDimensions(900, 400);

        const { container } = render(<ThemeParticles />);
        const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
        expect(canvas).not.toBeNull();
        expect(canvas!.style.bottom).toBe('');
    });
});
