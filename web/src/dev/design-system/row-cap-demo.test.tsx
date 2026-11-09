import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowCapDemo } from './row-cap-demo';

describe('RowCapDemo (ROK-2146 ShowAllToggle)', () => {
    it('shows 5 of 8 rows, then all 8 behind an aria-expanded toggle that controls the list', async () => {
        render(<RowCapDemo />);
        const demo = screen.getByTestId('ds-row-cap');
        expect(within(demo).getAllByRole('listitem')).toHaveLength(5);
        const toggle = within(demo).getByRole('button', { name: 'Show all 8' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveAttribute('aria-controls', within(demo).getByRole('list').id);
        await userEvent.click(toggle);
        expect(within(demo).getAllByRole('listitem')).toHaveLength(8);
        expect(within(demo).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    });
});
