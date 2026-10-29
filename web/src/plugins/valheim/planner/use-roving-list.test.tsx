/** ROK-1899 — one tab stop for the recipe list; Up/Down/Home/End move focus. */
import { describe, expect, it } from 'vitest';
import type { JSX } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { nextListIndex, useRovingList } from './use-roving-list';

function List({ count, selected }: { count: number; selected: number }): JSX.Element {
    const roving = useRovingList(count, selected);
    return (
        <ul onKeyDown={roving.onKeyDown}>
            {Array.from({ length: count }, (_, i) => (
                <li key={i}>
                    <button type="button" {...roving.itemProps(i)}>
                        Row {i}
                    </button>
                </li>
            ))}
        </ul>
    );
}

describe('nextListIndex', () => {
    it('moves and clamps; ignores keys the list does not own', () => {
        expect(nextListIndex('ArrowDown', 0, 3)).toBe(1);
        expect(nextListIndex('ArrowDown', 2, 3)).toBe(2);
        expect(nextListIndex('ArrowUp', 0, 3)).toBe(0);
        expect(nextListIndex('End', 0, 3)).toBe(2);
        expect(nextListIndex('Home', 2, 3)).toBe(0);
        expect(nextListIndex('ArrowLeft', 1, 3)).toBeNull();
    });
});

describe('useRovingList', () => {
    it('is one tab stop, on the selected row', () => {
        render(<List count={3} selected={1} />);
        const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
        expect(tabbable.map((b) => b.textContent)).toEqual(['Row 1']);
    });

    it('Up/Down/Home/End move focus and the tab stop follows', async () => {
        const user = userEvent.setup();
        render(<List count={4} selected={-1} />);
        await user.tab();
        expect(screen.getByRole('button', { name: 'Row 0' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('button', { name: 'Row 1' })).toHaveFocus();
        await user.keyboard('{End}');
        expect(screen.getByRole('button', { name: 'Row 3' })).toHaveFocus();
        await user.keyboard('{Home}');
        expect(screen.getByRole('button', { name: 'Row 0' })).toHaveFocus();
        await user.keyboard('{ArrowUp}');
        expect(screen.getByRole('button', { name: 'Row 0' })).toHaveFocus();
        await user.keyboard('{End}');
        expect(screen.getByRole('button', { name: 'Row 3' }).tabIndex).toBe(0);
    });
});
