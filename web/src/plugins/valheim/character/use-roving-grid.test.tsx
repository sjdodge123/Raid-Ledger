/** ROK-1836 — the inventory grid's roving tabindex: one tab stop, arrows / Home / End move focus. */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { nextGridCell, useRovingGrid } from './use-roving-grid';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Harness({ rows = 2, cols = 3 }: { rows?: number; cols?: number }) {
    const { tabIndexFor, gridProps } = useRovingGrid(rows, cols);
    return (
        <div role="grid" aria-label="g" {...gridProps}>
            {range(rows).map((r) => (
                <div role="row" key={r}>
                    {range(cols).map((c) => (
                        <button
                            key={c}
                            type="button"
                            data-rc={`${r},${c}`}
                            tabIndex={tabIndexFor(r, c)}
                        >
                            {`${r}-${c}`}
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );
}

const btn = (name: string) => screen.getByRole('button', { name });

describe('nextGridCell', () => {
    it.each([
        ['ArrowRight', { r: 0, c: 0 }, { r: 0, c: 1 }],
        ['ArrowRight', { r: 0, c: 2 }, { r: 0, c: 2 }],
        ['ArrowLeft', { r: 1, c: 0 }, { r: 1, c: 0 }],
        ['ArrowDown', { r: 0, c: 1 }, { r: 1, c: 1 }],
        ['ArrowDown', { r: 1, c: 1 }, { r: 1, c: 1 }],
        ['ArrowUp', { r: 1, c: 2 }, { r: 0, c: 2 }],
        ['Home', { r: 1, c: 2 }, { r: 1, c: 0 }],
        ['End', { r: 0, c: 0 }, { r: 0, c: 2 }],
    ])('%s from %o goes to %o', (key, from, want) =>
        expect(nextGridCell(key, from, 2, 3)).toEqual(want),
    );
    it('ignores keys it does not own', () =>
        expect(nextGridCell('a', { r: 0, c: 0 }, 2, 3)).toBeNull());
});

describe('useRovingGrid', () => {
    it('exposes exactly one tab stop and moves it with the arrow keys', () => {
        render(<Harness />);
        const stops = () =>
            screen
                .getAllByRole('button')
                .filter((b) => b.getAttribute('tabindex') === '0')
                .map((b) => b.textContent);
        expect(stops()).toEqual(['0-0']);
        btn('0-0').focus();
        fireEvent.keyDown(btn('0-0'), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(btn('0-1'));
        fireEvent.keyDown(btn('0-1'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(btn('1-1'));
        fireEvent.keyDown(btn('1-1'), { key: 'End' });
        expect(document.activeElement).toBe(btn('1-2'));
        fireEvent.keyDown(btn('1-2'), { key: 'Home' });
        expect(document.activeElement).toBe(btn('1-0'));
        expect(stops()).toEqual(['1-0']);
    });
    it('keeps exactly one tab stop when the grid shrinks under the active cell', () => {
        const { rerender } = render(<Harness rows={3} cols={3} />);
        btn('2-2').focus();
        rerender(<Harness rows={2} cols={2} />);
        const stops = screen
            .getAllByRole('button')
            .filter((b) => b.getAttribute('tabindex') === '0')
            .map((b) => b.textContent);
        expect(stops).toEqual(['1-1']);
    });
});
