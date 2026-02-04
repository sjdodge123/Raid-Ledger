import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RosterList } from './roster-list';

const mockSignups = [
    {
        id: 1,
        user: { id: 123, username: 'Player1', avatar: null },
        signedUpAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
        characterId: null,
        character: null,
        confirmationStatus: 'pending' as const,
    },
    {
        id: 2,
        user: { id: 456, username: 'Player2', avatar: 'abc123' },
        signedUpAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        characterId: 'char-uuid-1',
        character: {
            id: 'char-uuid-1',
            name: 'Frostweaver',
            class: 'Mage',
            spec: 'Arcane',
            role: 'dps' as const,
            isMain: true,
            itemLevel: 485,
            avatarUrl: null,
        },
        confirmationStatus: 'confirmed' as const,
    },
];

describe('RosterList', () => {
    it('renders empty state when no signups', () => {
        render(<RosterList signups={[]} />);
        expect(screen.getByText(/No signups yet/)).toBeInTheDocument();
    });

    it('renders user names for pending signups', () => {
        const pendingSignups = [mockSignups[0]];
        render(<RosterList signups={pendingSignups} />);
        expect(screen.getByText('Player1')).toBeInTheDocument();
    });

    it('renders character names for confirmed signups (AC-6)', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        // Character name should be displayed prominently
        expect(screen.getByText('Frostweaver')).toBeInTheDocument();
        // Username should still be visible
        expect(screen.getByText('Player2')).toBeInTheDocument();
        // Class should be shown
        expect(screen.getByText('Mage')).toBeInTheDocument();
    });

    it('renders pending confirmation indicator (AC-7)', () => {
        const pendingSignups = [mockSignups[0]];
        render(<RosterList signups={pendingSignups} />);
        expect(screen.getByText('❓')).toBeInTheDocument();
        expect(screen.getByText(/Awaiting confirmation/)).toBeInTheDocument();
    });

    it('renders main character badge', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        expect(screen.getByText('⭐')).toBeInTheDocument();
    });

    it('renders loading state with skeletons', () => {
        const { container } = render(<RosterList signups={[]} isLoading />);
        expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });

    it('renders Discord avatars', () => {
        render(<RosterList signups={mockSignups} />);
        const avatars = screen.getAllByRole('img');
        expect(avatars).toHaveLength(2);
        // Player2 has custom avatar hash
        expect(avatars[1]).toHaveAttribute('src', expect.stringContaining('456'));
    });

    it('shows item level for confirmed characters', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        expect(screen.getByText('485')).toBeInTheDocument();
    });

    it('renders role emoji for confirmed characters', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        expect(screen.getByText('⚔️')).toBeInTheDocument(); // DPS role icon
    });
});
