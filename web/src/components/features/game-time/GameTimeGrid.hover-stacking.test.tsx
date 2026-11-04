import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameTimeGrid } from './GameTimeGrid';
import { stubGridLayout } from '../../../test/stub-grid-layout';

// jsdom has no layout; GameTimeGrid refuses zero-sized measurements.
stubGridLayout();

/** Reads the Tailwind z-index utility (`z-10` / `z-[8]`) off an element, or null. */
function zIndexOf(el: HTMLElement): number | null {
    const match = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?=\s|$)/.exec(el.className);
    if (!match) return null;
    return Number(match[1] ?? match[2]);
}

/**
 * TD-1102: hovering a cell must never stack it above the block layer. The
 * layer's pointermove sets hover (ROK-1426); a hovered cell lifted to z-10
 * sat above the layer's z-[8] day targets and swallowed the next pointerdown,
 * so the tap created no block and no inspector.
 */
describe('GameTimeGrid — hovered cell stacking (TD-1102)', () => {
    it('keeps a hovered cell below the block layer on an interactive grid', () => {
        render(<GameTimeGrid slots={[]} onChange={vi.fn()} />);
        const layerZ = zIndexOf(screen.getByTestId('block-editor-layer'));
        expect(layerZ).toBe(8);

        fireEvent.pointerEnter(screen.getByTestId('cell-0-18'));

        const cellZ = zIndexOf(screen.getByTestId('cell-0-18')) ?? 0;
        expect(cellZ).toBeLessThan(layerZ ?? 0);
    });

    it('still lifts a hovered cell on a click-to-toggle grid with no block layer', () => {
        render(<GameTimeGrid slots={[]} onCellClick={vi.fn()} />);
        expect(screen.queryByTestId('block-editor-layer')).toBeNull();

        fireEvent.pointerEnter(screen.getByTestId('cell-0-18'));

        expect(screen.getByTestId('cell-0-18').className).toMatch(/(?:^|\s)z-10(?:\s|$)/);
    });
});
