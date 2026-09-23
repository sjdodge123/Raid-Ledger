import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Footer } from './Footer';

vi.mock('../../hooks/use-version', () => ({ useVersionInfo: () => ({ data: undefined }) }));

/**
 * ROK-1661 (iPad plan 2026-09-23-2034-11b7, steps 2-4): a box-shadow is ink
 * overflow, drawn only inside the document, so it could never reach the area
 * Safari shows past the document's end. That area is the root canvas colour
 * (`index.css`, guarded by `styles/root-canvas.guard.test.ts`); the footer
 * paints nothing outside its own box.
 */
describe('Regression: ROK-1661 — the footer casts no run-out shadow', () => {
    it('sets no inline box-shadow', () => {
        const { container } = render(<Footer />);
        const footer = container.querySelector('footer') as HTMLElement;
        expect(footer.style.boxShadow).toBe('');
    });
});
