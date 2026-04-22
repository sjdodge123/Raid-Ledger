/**
 * Tests for AiSuggestionCard (ROK-931).
 *
 * Verifies:
 *   - `mode='nominate'` renders a Nominate button that becomes "At cap"
 *     when `atCap` is true.
 *   - `mode='pick'` renders a Pick button that fires `onPick` with the
 *     suggestion DTO.
 *   - Ownership pill only renders when voterTotal > 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { AiSuggestionCard } from './AiSuggestionCard';
import { renderWithProviders } from '../../test/render-helpers';

function buildSuggestion(overrides: Partial<AiSuggestionDto> = {}): AiSuggestionDto {
    return {
        gameId: 42,
        name: 'Valheim',
        coverUrl: null,
        confidence: 0.8,
        reasoning: 'Fits co-op taste',
        ownershipCount: 3,
        voterTotal: 5,
        ...overrides,
    };
}

describe('AiSuggestionCard (ROK-931)', () => {
    it('renders the game name, reasoning, and ownership pill', () => {
        renderWithProviders(
            <AiSuggestionCard
                suggestion={buildSuggestion()}
                lineupId={7}
            />,
        );
        expect(screen.getByText('Valheim')).toBeInTheDocument();
        expect(screen.getByText('Fits co-op taste')).toBeInTheDocument();
        expect(screen.getByText('3/5 own')).toBeInTheDocument();
    });

    it('hides the ownership pill when voterTotal is 0', () => {
        renderWithProviders(
            <AiSuggestionCard
                suggestion={buildSuggestion({ voterTotal: 0, ownershipCount: 0 })}
                lineupId={7}
            />,
        );
        expect(screen.queryByText(/own/)).not.toBeInTheDocument();
    });

    it('shows "At cap" when atCap is true in nominate mode', () => {
        renderWithProviders(
            <AiSuggestionCard
                suggestion={buildSuggestion()}
                lineupId={7}
                mode="nominate"
                atCap
            />,
        );
        const btn = screen.getByRole('button', { name: /at cap/i });
        expect(btn).toBeDisabled();
    });

    it('fires onPick with the suggestion DTO when Pick is clicked', async () => {
        const handlePick = vi.fn();
        const suggestion = buildSuggestion();
        renderWithProviders(
            <AiSuggestionCard
                suggestion={suggestion}
                lineupId={7}
                mode="pick"
                onPick={handlePick}
            />,
        );
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Pick' }));
        expect(handlePick).toHaveBeenCalledTimes(1);
        expect(handlePick).toHaveBeenCalledWith(suggestion);
    });
});
