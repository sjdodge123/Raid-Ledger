import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RosterBuilder } from './RosterBuilder';
import type { RosterRole } from '@raid-ledger/contract';

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

describe('RosterBuilder', () => {
    const mockPool = [
        {
            id: 0,
            signupId: 1,
            userId: 101,
            discordId: '101101101',
            username: 'PlayerOne',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'char-1',
                name: 'Tanker',
                className: 'Warrior',
                role: 'tank',
                avatarUrl: null,
            },
        },
    ];

    const mockAssignments = [
        {
            id: 1,
            signupId: 2,
            userId: 102,
            discordId: '102102102',
            username: 'HealerOne',
            avatar: null,
            slot: 'healer' as RosterRole,
            position: 1,
            isOverride: false,
            character: {
                id: 'char-2',
                name: 'Healy',
                className: 'Priest',
                role: 'healer',
                avatarUrl: null,
            },
        },
    ];

    const mockOnRosterChange = vi.fn();

    it('renders assigned players in slots', () => {
        render(
            <RosterBuilder
                pool={mockPool}
                assignments={mockAssignments}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Check if assigned item is rendered
        expect(screen.getByText('HealerOne')).toBeInTheDocument();
        expect(screen.getByText('Healer (1/4)')).toBeInTheDocument();
    });

    it('renders correct number of slots', () => {
        render(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Check Tank slots (default 2)
        expect(screen.getByText('Tank (0/2)')).toBeInTheDocument();

        // Check Healer slots (default 4)
        expect(screen.getByText('Healer (0/4)')).toBeInTheDocument();

        // Check DPS slots (default 14)
        expect(screen.getByText('DPS (0/14)')).toBeInTheDocument();
    });

    it('renders UnassignedBar with pool count', () => {
        render(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        // Count badge in the unassigned bar
        const countBadge = document.querySelector('.unassigned-bar__count');
        expect(countBadge).toHaveTextContent('1');
    });

    it('shows "All players assigned ✓" when pool is empty', () => {
        render(
            <RosterBuilder
                pool={[]}
                assignments={mockAssignments}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getByText('All players assigned ✓')).toBeInTheDocument();
    });

    it('shows "+ Join" for regular users on empty slots', () => {
        const mockSlotClick = vi.fn();
        render(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                onSlotClick={mockSlotClick}
            />
        );

        // All empty slots should show "+ Join" text
        const joinButtons = screen.getAllByText('Join');
        expect(joinButtons.length).toBeGreaterThan(0);
    });

    it('shows "Empty" text for non-interactive empty slots', () => {
        render(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={false}
            />
        );

        // Empty slots without click handler show "Empty"
        const emptySlots = screen.getAllByText('Empty');
        expect(emptySlots.length).toBeGreaterThan(0);
    });

    it('opens assignment popup when admin clicks slot', () => {
        render(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Click first tank slot
        const slotElements = screen.getAllByText('Join');
        fireEvent.click(slotElements[0].closest('div[class*="min-h"]')!);

        // Assignment popup should appear
        expect(screen.getByText(/Assign to/)).toBeInTheDocument();
    });

    it('renders generic player slots for non-MMO games', () => {
        render(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                slots={{ player: 8 }}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
            />
        );

        expect(screen.getByText('Players (0/8)')).toBeInTheDocument();
    });
});
