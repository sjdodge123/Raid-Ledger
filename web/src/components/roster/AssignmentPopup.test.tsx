import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AssignmentPopup } from './AssignmentPopup';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

/** Wrap component in MemoryRouter for Link context */
function renderWithRouter(ui: ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AssignmentPopup', () => {
    const mockUnassigned: RosterAssignmentResponse[] = [
        {
            id: 0,
            signupId: 1,
            userId: 101,
            discordId: '101',
            username: 'TankPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c1',
                name: 'Tankadin',
                className: 'Paladin',
                role: 'tank',
                avatarUrl: null,
            },
        },
        {
            id: 0,
            signupId: 2,
            userId: 102,
            discordId: '102',
            username: 'DPSPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c2',
                name: 'Firemage',
                className: 'Mage',
                role: 'dps',
                avatarUrl: null,
            },
        },
        {
            id: 0,
            signupId: 3,
            userId: 103,
            discordId: '103',
            username: 'HealPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c3',
                name: 'Healbot',
                className: 'Priest',
                role: 'healer',
                avatarUrl: null,
            },
        },
    ];

    const mockOnAssign = vi.fn();
    const mockOnClose = vi.fn();
    const mockOnRemove = vi.fn();

    it('renders role-sorted list with matching role first', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
            />
        );

        // Title should show slot
        expect(screen.getByText('Assign to Tank 1')).toBeInTheDocument();

        // Matching role section should exist
        expect(screen.getByText(/Matching Role/)).toBeInTheDocument();

        // TankPlayer should be visible (matching role)
        expect(screen.getByText('TankPlayer')).toBeInTheDocument();
    });

    it('filters by search input', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
            />
        );

        const searchInput = screen.getByPlaceholderText('Search by name...');
        fireEvent.change(searchInput, { target: { value: 'DPS' } });

        // Only DPSPlayer should remain
        expect(screen.getByText('DPSPlayer')).toBeInTheDocument();
        expect(screen.queryByText('TankPlayer')).not.toBeInTheDocument();
        expect(screen.queryByText('HealPlayer')).not.toBeInTheDocument();
    });

    it('shows "Remove to Unassigned" for filled slots', () => {
        const occupant: RosterAssignmentResponse = {
            id: 1,
            signupId: 10,
            userId: 110,
            discordId: '110',
            username: 'OccupantPlayer',
            avatar: null,
            slot: 'tank' as RosterRole,
            position: 1,
            isOverride: false,
            character: {
                id: 'c10',
                name: 'BigTank',
                className: 'Warrior',
                role: 'tank',
                avatarUrl: null,
            },
        };

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
            />
        );

        expect(screen.getByText('Remove')).toBeInTheDocument();
        expect(screen.getByText('OccupantPlayer')).toBeInTheDocument();
    });

    it('calls onAssign when clicking Assign button', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
            />
        );

        const assignButtons = screen.getAllByText('Assign');
        fireEvent.click(assignButtons[0]);

        expect(mockOnAssign).toHaveBeenCalledWith(expect.any(Number));
    });

    it('shows empty state when no players', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={[]}
                onAssign={mockOnAssign}
            />
        );

        expect(screen.getByText(/All players are assigned to slots/)).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={false}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
            />
        );

        expect(screen.queryByText('Assign to Tank 1')).not.toBeInTheDocument();
    });
});
