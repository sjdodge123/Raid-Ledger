/** ROK-1882 — the admin per-server timezone (play-day boundary) on a Pelican server row. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { pelicanServerFixture } from '../../../test/mocks/pelican-handlers';
import { COMMUNITY_DEFAULT_LABEL, ServerTimezoneSelect } from './pelican-server-timezone';

function renderSelect(row: PelicanServerRowDto) {
    const onUpdate = vi.fn();
    renderWithProviders(<ServerTimezoneSelect row={row} onUpdate={onUpdate} />);
    return { onUpdate, select: screen.getByTestId(`pelican-server-${row.id}-timezone`) };
}

describe('ServerTimezoneSelect (ROK-1882)', () => {
    it('shows Community default when the server has no zone (null or absent)', () => {
        const { select } = renderSelect({ ...pelicanServerFixture, timezone: null });
        expect(select).toHaveValue('');
        expect(screen.getByRole('option', { name: COMMUNITY_DEFAULT_LABEL })).toBeInTheDocument();
    });

    it('picking a zone PATCHes { timezone: <IANA id> }', async () => {
        const row = { ...pelicanServerFixture, timezone: null };
        const { select, onUpdate } = renderSelect(row);
        await userEvent.selectOptions(select, 'Europe/Berlin');
        expect(onUpdate).toHaveBeenCalledWith(row.id, { timezone: 'Europe/Berlin' });
    });

    it('picking Community default clears it with { timezone: null }', async () => {
        const row = { ...pelicanServerFixture, timezone: 'Europe/Berlin' };
        const { select, onUpdate } = renderSelect(row);
        expect(select).toHaveValue('Europe/Berlin');
        await userEvent.selectOptions(select, '');
        expect(onUpdate).toHaveBeenCalledWith(row.id, { timezone: null });
    });

    it('keeps a stored zone that is not in the curated list as the selected value', () => {
        const { select } = renderSelect({ ...pelicanServerFixture, timezone: 'Antarctica/Troll' });
        expect(select).toHaveValue('Antarctica/Troll');
        expect(screen.getByRole('option', { name: 'Antarctica/Troll' })).toBeInTheDocument();
    });
});
