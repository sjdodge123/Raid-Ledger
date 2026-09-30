import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RosterBuilder } from './RosterBuilder';
import { renderWithRouter, mockPool } from './RosterBuilder.test-helpers';

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ROK-734: Single-click join flow (replaces two-click confirmation from ROK-353)
describe('RosterBuilder — single-click join flow (ROK-734)', () => {
    const mockOnRosterChange = vi.fn();
    const mockSlotClick = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('single click on empty slot immediately triggers onSlotClick', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                onSlotClick={mockSlotClick}
            />
        );

        fireEvent.click(screen.getAllByRole('button', { name: /^Join \S+ slot \d+$/ })[0]);

        expect(mockSlotClick).toHaveBeenCalledTimes(1);
        expect(mockSlotClick).toHaveBeenCalledWith('tank', 1);
    });

    it('no intermediate "Join?" confirmation state appears', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                onSlotClick={mockSlotClick}
            />
        );

        fireEvent.click(screen.getAllByRole('button', { name: /^Join \S+ slot \d+$/ })[0]);

        expect(screen.queryByText('Join?')).not.toBeInTheDocument();
    });

    it('clicking different empty slots triggers onSlotClick for each', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                onSlotClick={mockSlotClick}
            />
        );

        expect(screen.getAllByText('Join').length).toBeGreaterThan(1);

        const firstSlot = screen.getAllByRole('button', { name: /^Join \S+ slot \d+$/ })[0];
        fireEvent.click(firstSlot);
        expect(mockSlotClick).toHaveBeenCalledTimes(1);
        expect(mockSlotClick).toHaveBeenCalledWith('tank', 1);

        const secondSlot = screen.getAllByRole('button', { name: /^Join \S+ slot \d+$/ })[1];
        fireEvent.click(secondSlot);
        expect(mockSlotClick).toHaveBeenCalledTimes(2);
        expect(mockSlotClick).toHaveBeenCalledWith('tank', 2);
    });

    it('empty slots are not clickable when canJoin is false', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={false}
                onSlotClick={mockSlotClick}
            />
        );

        expect(screen.queryByText('Join')).not.toBeInTheDocument();
        expect(mockSlotClick).not.toHaveBeenCalled();
    });

    it('admin assignment popup is unaffected by join flow', () => {
        renderWithRouter(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
                canJoin={false}
            />
        );

        const assignLabels = screen.getAllByText('Assign');
        expect(assignLabels.length).toBeGreaterThan(0);
        expect(screen.queryByText('Join')).not.toBeInTheDocument();

        const firstSlot = screen.getAllByRole('button', { name: /^Assign \S+ slot \d+$/ })[0];
        fireEvent.click(firstSlot);

        expect(screen.getByText(/Assign to/)).toBeInTheDocument();
        expect(screen.queryByText('Join?')).not.toBeInTheDocument();
    });
});
