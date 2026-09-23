import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Footer } from './Footer';

vi.mock('../../hooks/use-version', () => ({ useVersionInfo: () => ({ data: undefined }) }));

/**
 * ROK-1661 (iPad plan 2026-09-23-1846-507b, steps 3/4/6): iPad Safari scrolls a
 * page to the bottom of its layout viewport, past a short page's end, and left
 * a blank band under the footer. The footer paints that run-out in its own
 * surface colour with a shadow, which adds no scroll height.
 */
describe('Regression: ROK-1661 — footer paints the Safari scroll run-out below itself', () => {
    it('casts a surface-coloured shadow a full large-viewport height below the footer', () => {
        const { container } = render(<Footer />);
        const footer = container.querySelector('footer') as HTMLElement;
        expect(footer.style.boxShadow).toBe('0 100lvh 0 100lvh var(--color-surface)');
    });
});
