/** ROK-2187 — a GG card body that is taller than the stage scrolls, so every control stays reachable. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GgCardBody } from './gg-card-parts';

function stubHeights(scrollHeight: number, clientHeight: number): void {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

describe('GgCardBody (ROK-2187)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('adds no padding of its own on top of the slide body (no double padding)', () => {
        render(<GgCardBody><button type="button">Replay</button></GgCardBody>);
        const body = screen.getByTestId('gg-card-body');
        expect(body.className).not.toMatch(/(^|\s)(pt-16|pb-8|px-6)(\s|$)/);
    });

    it('is a vertical scroller that can shrink inside the stage', () => {
        render(<GgCardBody><p>stats</p></GgCardBody>);
        const body = screen.getByTestId('gg-card-body');
        expect(body.className).toContain('overflow-y-auto');
        expect(body.className).toContain('min-h-0');
    });

    it('takes pointer input only when its content overflows (short viewport)', () => {
        stubHeights(900, 400);
        render(<GgCardBody><button type="button">Replay</button></GgCardBody>);
        const body = screen.getByTestId('gg-card-body');
        expect(body).toHaveAttribute('data-scrollable', 'true');
        expect(body.className).toContain('pointer-events-auto');
    });

    it('leaves taps to the story when everything fits', () => {
        stubHeights(300, 400);
        render(<GgCardBody><button type="button">Replay</button></GgCardBody>);
        const body = screen.getByTestId('gg-card-body');
        expect(body).toHaveAttribute('data-scrollable', 'false');
        expect(body.className).not.toContain('pointer-events-auto');
    });
});
