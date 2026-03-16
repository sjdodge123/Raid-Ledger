/**
 * Tests for PlayerFilters component (ROK-821).
 * Verifies source checkboxes, play history dropdown, playtime input, role dropdown.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerFilters } from './player-filters';
import { renderWithProviders } from '../../test/render-helpers';
import type { PlayerFilters as PlayerFiltersType } from '../../hooks/use-player-filters';

const defaultFilters: PlayerFiltersType = {};
const noop = vi.fn();

function renderFilters(filters: PlayerFiltersType = defaultFilters, setFilter = noop) {
    return renderWithProviders(
        <PlayerFilters filters={filters} setFilter={setFilter} />,
    );
}

describe('PlayerFilters — source checkboxes', () => {
    it('renders four source checkboxes', () => {
        renderFilters();
        expect(screen.getByLabelText(/manual/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/discord/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/steam library/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/steam wishlist/i)).toBeInTheDocument();
    });

    it('all checkboxes checked by default (empty = all sources)', () => {
        renderFilters();
        const manual = screen.getByLabelText(/manual/i) as HTMLInputElement;
        expect(manual.checked).toBe(true);
    });

    it('checks sources when filter has them', () => {
        renderFilters({ sources: ['manual', 'discord'] });
        const manual = screen.getByLabelText(/manual/i) as HTMLInputElement;
        const discord = screen.getByLabelText(/discord/i) as HTMLInputElement;
        expect(manual.checked).toBe(true);
        expect(discord.checked).toBe(true);
    });

    it('unchecking one source sends the remaining three', async () => {
        const user = userEvent.setup();
        const setFilter = vi.fn();
        renderFilters({}, setFilter);
        await user.click(screen.getByLabelText(/manual/i));
        expect(setFilter).toHaveBeenCalledWith('sources', ['discord', 'steam_library', 'steam_wishlist']);
    });
});

describe('PlayerFilters — play history dropdown', () => {
    it('renders play history select', () => {
        renderFilters();
        expect(screen.getByLabelText(/play history/i)).toBeInTheDocument();
    });

    it('shows "Any" as default', () => {
        renderFilters();
        const select = screen.getByLabelText(/play history/i) as HTMLSelectElement;
        expect(select.value).toBe('');
    });

    it('calls setFilter on change (requires gameId)', async () => {
        const user = userEvent.setup();
        const setFilter = vi.fn();
        renderFilters({ gameId: 1 }, setFilter);
        await user.selectOptions(screen.getByLabelText(/play history/i), 'played_recently');
        expect(setFilter).toHaveBeenCalledWith('playHistory', 'played_recently');
    });
});

describe('PlayerFilters — playtime input', () => {
    it('renders playtime min input', () => {
        renderFilters();
        expect(screen.getByLabelText(/min hours/i)).toBeInTheDocument();
    });
});

describe('PlayerFilters — role dropdown', () => {
    it('renders role select', () => {
        renderFilters();
        expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    });

    it('shows "All" as default', () => {
        renderFilters();
        const select = screen.getByLabelText(/role/i) as HTMLSelectElement;
        expect(select.value).toBe('');
    });

    it('calls setFilter on change', async () => {
        const user = userEvent.setup();
        const setFilter = vi.fn();
        renderFilters({}, setFilter);
        await user.selectOptions(screen.getByLabelText(/role/i), 'admin');
        expect(setFilter).toHaveBeenCalledWith('role', 'admin');
    });
});
