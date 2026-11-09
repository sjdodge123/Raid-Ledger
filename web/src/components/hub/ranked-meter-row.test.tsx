/** ROK-2148 — the shared ranked leaderboard row: plain rank number vs a leading badge slot. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RankedMeterRow } from './ranked-meter-row';

describe('RankedMeterRow', () => {
    it('draws the plain rank number, the name, the figure and a labelled meter when no badge is given', () => {
        render(<ol><RankedMeterRow rank={4} name="Thessaly" trailing="80% · 4/5" pct={80} meterLabel="Thessaly attendance" testId="row" /></ol>);
        const row = screen.getByTestId('row');
        expect(row.tagName).toBe('LI');
        expect(within(row).getByTestId('ranked-row-rank')).toHaveTextContent('4');
        expect(row).toHaveTextContent('Thessaly');
        expect(row).toHaveTextContent('80% · 4/5');
        expect(within(row).getByRole('meter', { name: 'Thessaly attendance' })).toHaveAttribute('aria-valuenow', '80');
    });

    it('puts the badge in the rank slot instead of the plain number', () => {
        render(
            <RankedMeterRow as="div" rank={1} badge={<span data-testid="medal">gold</span>} name="Morwenna"
                trailing="142 items" pct={100} meterLabel="Morwenna: 142 items" testId="row" />,
        );
        const row = screen.getByTestId('row');
        expect(row.tagName).toBe('DIV');
        expect(within(row).getByTestId('medal')).toHaveTextContent('gold');
        expect(within(row).queryByTestId('ranked-row-rank')).not.toBeInTheDocument();
    });
});
