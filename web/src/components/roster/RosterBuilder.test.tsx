import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RosterBuilder } from './RosterBuilder';
import type { RosterRole } from '@raid-ledger/contract';

// Mock dnd-kit because it relies on browser APIs not fully present in jsdom
// However, RosterBuilder uses DndContext internally, so we test basic rendering first.

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
            },
        },
    ];

    const mockOnRosterChange = vi.fn();

    it('renders pool and assignments', () => {
        render(
            <RosterBuilder
                pool={mockPool}
                assignments={mockAssignments}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Check if pool item is rendered
        expect(screen.getByText('PlayerOne')).toBeInTheDocument();
        expect(screen.getByText(/Tanker/)).toBeInTheDocument();

        // Check if assigned item is rendered
        expect(screen.getByText('HealerOne')).toBeInTheDocument();
        expect(screen.getByText('Healer')).toBeInTheDocument(); // Role label
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

    it('shows "Drop [role] here" for empty slots', () => {
        render(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getAllByText('Drop tank here').length).toBeGreaterThan(0);
    });
});
