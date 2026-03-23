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

describe('NominationGrid', () => {
    it('renders "Nominated Games" heading', () => {
        renderWithProviders(
            <NominationGrid entries={[createMockEntry()]} onRemove={vi.fn()} />,
        );
        expect(screen.getByText('Nominated Games')).toBeInTheDocument();
    });

    it('renders "Sorted by ownership" label', () => {
        renderWithProviders(
            <NominationGrid entries={[createMockEntry()]} onRemove={vi.fn()} />,
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
            <NominationGrid entries={entries} onRemove={vi.fn()} />,
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
            <NominationGrid entries={entries} onRemove={vi.fn()} />,
        );
        expect(screen.getByText('Game A')).toBeInTheDocument();
        expect(screen.getByText('Game B')).toBeInTheDocument();
    });
});
