/**
 * Adversarial tests for PlayerFilterBar component (ROK-803).
 * Edge cases: typing in Game ID input, gameId pre-population, clearing
 * individual params, invalid URL params, a11y.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PlayerFilterBar } from './player-filter-bar';
import { renderWithProviders } from '../../test/render-helpers';

function renderFilterBar(initialEntries: string[] = ['/players']) {
    return renderWithProviders(<PlayerFilterBar />, { initialEntries });
}

describe('PlayerFilterBar — adversarial', () => {
    it('pre-populates the Game ID input from URL gameId param', () => {
        renderFilterBar(['/players?gameId=99']);
        const input = screen.getByLabelText(/game/i) as HTMLInputElement;
        expect(input.value).toBe('99');
    });

    it('pre-populates both source and gameId from URL params simultaneously', () => {
        renderFilterBar(['/players?gameId=42&source=steam_wishlist']);
        const input = screen.getByLabelText(/game/i) as HTMLInputElement;
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        expect(input.value).toBe('42');
        expect(dropdown.value).toBe('steam_wishlist');
    });

    it('shows clear button when only gameId param is set', () => {
        renderFilterBar(['/players?gameId=10']);
        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('shows clear button when both gameId and source are set', () => {
        renderFilterBar(['/players?gameId=10&source=steam_library']);
        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('clears both source and gameId when clear button is clicked', async () => {
        const user = userEvent.setup();
        renderFilterBar(['/players?gameId=5&source=steam_library']);

        await user.click(screen.getByRole('button', { name: /clear/i }));

        const input = screen.getByLabelText(/game/i) as HTMLInputElement;
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        expect(input.value).toBe('');
        expect(dropdown.value).toBe('');
    });

    it('hides clear button after clearing filters', async () => {
        const user = userEvent.setup();
        renderFilterBar(['/players?source=steam_wishlist']);

        await user.click(screen.getByRole('button', { name: /clear/i }));

        expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('allows typing a game ID into the Game input', async () => {
        const user = userEvent.setup();
        renderFilterBar();

        const input = screen.getByLabelText(/game/i);
        await user.type(input, '123');

        expect((input as HTMLInputElement).value).toBe('123');
    });

    it('shows clear button after typing a game ID', async () => {
        const user = userEvent.setup();
        renderFilterBar();

        const input = screen.getByLabelText(/game/i);
        await user.type(input, '7');

        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('clearing the game ID input removes clear button when source is empty', async () => {
        const user = userEvent.setup();
        renderFilterBar(['/players?gameId=5']);

        const input = screen.getByLabelText(/game/i);
        await user.clear(input);

        expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('treats unrecognised source param gracefully — select shows it or falls back', () => {
        // An unknown source value won't match any option, so the select
        // falls back to the first option (empty string = All Sources).
        renderFilterBar(['/players?source=unknown_source']);
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        // The dropdown should still render without crashing
        expect(dropdown).toBeInTheDocument();
    });

    it('renders the All Sources option by default', () => {
        renderFilterBar();
        const dropdown = screen.getByLabelText(/source/i) as HTMLSelectElement;
        expect(dropdown.value).toBe('');
    });

    it('source dropdown contains Owns (Steam) and Wishlisted (Steam) options', () => {
        renderFilterBar();
        expect(screen.getByRole('option', { name: 'Owns (Steam)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Wishlisted (Steam)' })).toBeInTheDocument();
    });

    it('source dropdown contains All Sources as default option', () => {
        renderFilterBar();
        expect(screen.getByRole('option', { name: 'All Sources' })).toBeInTheDocument();
    });

    it('selecting steam_library updates the dropdown value', async () => {
        const user = userEvent.setup();
        renderFilterBar();
        const dropdown = screen.getByLabelText(/source/i);
        await user.selectOptions(dropdown, 'steam_library');
        expect((dropdown as HTMLSelectElement).value).toBe('steam_library');
    });

    it('has no accessibility violations', async () => {
        const { container } = renderFilterBar();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
