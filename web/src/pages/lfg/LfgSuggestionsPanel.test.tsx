/**
 * ROK-1464 AC5 — "Might want in".
 *
 * Every row must carry a REASON — an unexplained suggestion is indistinguishable
 * from a random player list. Invite buttons are inert placeholders until
 * ROK-1455 ships the DM (D7), so they must render disabled, not absent.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockSuggestion } from '../../test/lfg-factories';
import { LfgSuggestionsPanel } from './LfgSuggestionsPanel';

describe('LfgSuggestionsPanel', () => {
    it('names every reason a player was suggested for', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                suggestions={{
                    gameId: 7,
                    suggestions: [
                        createMockSuggestion({
                            displayName: 'Bo',
                            reasons: ['played', 'owns'],
                        }),
                    ],
                }}
            />,
        );

        expect(screen.getByText('Bo')).toBeInTheDocument();
        expect(screen.getByText('played before')).toBeInTheDocument();
        expect(screen.getByText('owns it')).toBeInTheDocument();
        expect(
            screen.getByText('Has played this with the group'),
        ).toBeInTheDocument();
    });

    it('explains a hearted-only suggestion in its own words', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                suggestions={{
                    gameId: 7,
                    suggestions: [
                        createMockSuggestion({
                            userId: 5,
                            displayName: null,
                            username: 'cass',
                            reasons: ['hearted'],
                        }),
                    ],
                }}
            />,
        );

        expect(screen.getByText('cass')).toBeInTheDocument();
        expect(screen.getByText('hearted it')).toBeInTheDocument();
        expect(screen.getByText('Hearted this game')).toBeInTheDocument();
    });
});

describe('LfgSuggestionsPanel — invite placeholder', () => {
    it('renders the invite affordance disabled until ROK-1455 lands', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                suggestions={{
                    gameId: 7,
                    suggestions: [createMockSuggestion()],
                }}
            />,
        );

        const invite = screen.getByTestId('lfg-invite-placeholder');
        expect(invite).toBeDisabled();
        expect(invite).toHaveAttribute('title', 'Invites arrive with ROK-1455');
    });

    it('says there is nobody to suggest when the list is empty', () => {
        renderWithProviders(
            <LfgSuggestionsPanel
                suggestions={{ gameId: 7, suggestions: [] }}
            />,
        );

        expect(
            screen.getByText('Nobody else to suggest right now'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-invite-placeholder')).toBeNull();
    });
});
