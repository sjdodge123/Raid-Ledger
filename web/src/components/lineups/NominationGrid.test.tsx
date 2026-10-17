/**
 * Tests for NominationGrid (ROK-935).
 * Validates heading, sorting by ownership, and empty state delegation.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockEntry } from '../../test/lineup-factories';
import { NominationGrid } from './NominationGrid';

// Mock auth for NominationCard
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

// Mock useRemoveNomination
vi.mock('../../hooks/use-lineups', () => ({
    useRemoveNomination: vi.fn(() => ({ mutate: vi.fn() })),
}));

describe('NominationGrid', () => {
    it('renders "Nominated Games" heading', () => {
        renderWithProviders(
            <NominationGrid entries={[createMockEntry()]} lineupId={1} />,
        );
        expect(screen.getByText('Nominated Games')).toBeInTheDocument();
    });

    it('renders "Sorted by ownership" label', () => {
        renderWithProviders(
            <NominationGrid entries={[createMockEntry()]} lineupId={1} />,
        );
        expect(screen.getByText(/sorted by ownership/i)).toBeInTheDocument();
    });

    it('renders entries sorted by ownerCount descending', () => {
        const entries = [
            createMockEntry({ id: 1, gameId: 1, gameName: 'Low', ownerCount: 2 }),
            createMockEntry({ id: 2, gameId: 2, gameName: 'High', ownerCount: 8 }),
            createMockEntry({ id: 3, gameId: 3, gameName: 'Mid', ownerCount: 5 }),
        ];
        renderWithProviders(
            <NominationGrid entries={entries} lineupId={1} />,
        );
        const gameNames = screen.getAllByText(/High|Mid|Low/).map((el) => el.textContent);
        expect(gameNames).toEqual(['High', 'Mid', 'Low']);
    });

    it('renders the correct number of cards', () => {
        const entries = [
            createMockEntry({ id: 1, gameId: 1, gameName: 'Game A' }),
            createMockEntry({ id: 2, gameId: 2, gameName: 'Game B' }),
        ];
        renderWithProviders(
            <NominationGrid entries={entries} lineupId={1} />,
        );
        expect(screen.getByText('Game A')).toBeInTheDocument();
        expect(screen.getByText('Game B')).toBeInTheDocument();
    });
});

describe('NominationGrid — per-card confirmation pill (ROK-1209 AC-5)', () => {
    it("shows the pill ONLY on cards the current user nominated", () => {
        const entries = [
            // Mine
            createMockEntry({ id: 1, gameId: 1, gameName: 'Mine A', nominatedBy: { id: 99, displayName: 'Me' } }),
            // Theirs
            createMockEntry({ id: 2, gameId: 2, gameName: 'Theirs', nominatedBy: { id: 5, displayName: 'Other' } }),
            // Mine again
            createMockEntry({ id: 3, gameId: 3, gameName: 'Mine B', nominatedBy: { id: 99, displayName: 'Me' } }),
        ];
        renderWithProviders(<NominationGrid entries={entries} lineupId={1} />);
        // Two pills, one per user-owned card.
        const pills = screen.getAllByTestId('confirmation-pill');
        expect(pills).toHaveLength(2);
    });

    it('does not render any pill when the user has no nominations', () => {
        const entries = [
            createMockEntry({ id: 1, gameId: 1, gameName: 'Theirs A', nominatedBy: { id: 5, displayName: 'Other' } }),
            createMockEntry({ id: 2, gameId: 2, gameName: 'Theirs B', nominatedBy: { id: 6, displayName: 'Other2' } }),
        ];
        renderWithProviders(<NominationGrid entries={entries} lineupId={1} />);
        expect(screen.queryByTestId('confirmation-pill')).not.toBeInTheDocument();
    });
});
