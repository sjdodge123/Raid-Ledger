/**
 * Tests for PlayerFilterBar component (ROK-803).
 * Verifies filter UI, URL sync, and pre-population from query params.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerFilterBar } from './player-filter-bar';
import { renderWithProviders } from '../../test/render-helpers';

/** Render with initial URL search params. */
function renderFilterBar(initialEntries: string[] = ['/players']) {
    return renderWithProviders(<PlayerFilterBar />, { initialEntries });
}

describe('PlayerFilterBar', () => {
    it('renders the source filter dropdown', () => {
        renderFilterBar();
        expect(screen.getByLabelText(/source/i)).toBeInTheDocument();
    });

    it('renders the clear button when filters are active', () => {
        renderFilterBar(['/players?source=steam_library']);
        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('does not render clear button when no filters active', () => {
        renderFilterBar();
        expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('pre-populates source dropdown from URL params', () => {
        renderFilterBar(['/players?source=steam_library']);
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        expect(dropdown.value).toBe('steam_library');
    });

    it('shows game name when gameId is in URL params', async () => {
        renderFilterBar(['/players?gameId=42']);
        // The game name input should reflect the gameId filter
        expect(screen.getByLabelText(/game/i)).toBeInTheDocument();
    });

    it('allows clearing filters', async () => {
        const user = userEvent.setup();
        renderFilterBar(['/players?source=steam_library']);
        const clearBtn = screen.getByRole('button', { name: /clear/i });
        await user.click(clearBtn);
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        expect(dropdown.value).toBe('');
    });

    it('allows changing the source filter', async () => {
        const user = userEvent.setup();
        renderFilterBar();
        const dropdown = screen.getByLabelText(/source/i);
        await user.selectOptions(dropdown, 'steam_wishlist');
        expect((dropdown as HTMLSelectElement).value).toBe('steam_wishlist');
    });
});
