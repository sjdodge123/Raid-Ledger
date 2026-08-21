/**
 * Co-op pill on the AI suggestion cards (ROK-1401).
 *
 * Suggestions are NOT stubs — `enrichSuggestions` builds each DTO from a real
 * `games` row join, so the raw `cooptimus_online_max` threads through the
 * same way it does for Common Ground. Same strict rule: positive renders,
 * `0`/`null` render no element.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { AiSuggestionDto } from '@raid-ledger/contract';
import { AiSuggestionCard } from './AiSuggestionCard';
import { renderWithProviders } from '../../test/render-helpers';

const PILL = 'coop-pill';

function buildSuggestion(
    overrides: Partial<AiSuggestionDto> = {},
): AiSuggestionDto {
    return {
        gameId: 42,
        name: 'Valheim',
        coverUrl: null,
        confidence: 0.8,
        reasoning: 'Fits co-op taste',
        ownershipCount: 3,
        voterTotal: 5,
        cooptimusOnlineMax: null,
        ...overrides,
    } as AiSuggestionDto;
}

function renderCard(suggestion: AiSuggestionDto) {
    return renderWithProviders(
        <AiSuggestionCard suggestion={suggestion} lineupId={7} />,
    );
}

describe('AiSuggestionCard — co-op pill present when enriched', () => {
    it('renders the pill next to the ownership pill', () => {
        renderCard(buildSuggestion({ cooptimusOnlineMax: 4 }));
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 co-op');
        expect(screen.getByText('3/5 own')).toBeInTheDocument();
    });

    it('renders the pill even when the ownership pill is suppressed', () => {
        // OwnershipPill returns null at voterTotal 0; the co-op pill is
        // independent of it and must still render.
        renderCard(buildSuggestion({ cooptimusOnlineMax: 6, voterTotal: 0 }));
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 6 co-op');
        expect(screen.queryByText(/own$/)).toBeNull();
    });
});

describe('AiSuggestionCard — co-op pill absent, no layout hole', () => {
    function expectPillDisappears(suggestion: AiSuggestionDto) {
        const { rerender } = renderCard(
            buildSuggestion({ cooptimusOnlineMax: 4 }),
        );
        expect(screen.getByTestId(PILL)).toBeInTheDocument();
        rerender(<AiSuggestionCard suggestion={suggestion} lineupId={7} />);
        expect(screen.queryByTestId(PILL)).toBeNull();
    }

    it('renders no pill when cooptimusOnlineMax is null', () => {
        expectPillDisappears(buildSuggestion({ cooptimusOnlineMax: null }));
    });

    it('renders no pill when cooptimusOnlineMax is 0', () => {
        expectPillDisappears(buildSuggestion({ cooptimusOnlineMax: 0 }));
    });

    it('leaves the card body intact when the pill is absent', () => {
        expectPillDisappears(buildSuggestion({ cooptimusOnlineMax: null }));
        expect(screen.getByText('Valheim')).toBeInTheDocument();
        expect(screen.getByText('3/5 own')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /nominate/i }),
        ).toBeInTheDocument();
    });
});
