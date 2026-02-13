import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UnassignedBar } from './UnassignedBar';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';

describe('UnassignedBar', () => {
    const makePlayers = (count: number): RosterAssignmentResponse[] =>
        Array.from({ length: count }, (_, i) => ({
            id: i,
            signupId: i + 1,
            userId: 100 + i,
            discordId: `${100 + i}`,
            username: `Player${i + 1}`,
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: null,
        }));

    const mockOnBarClick = vi.fn();

    it('renders correct avatar count and pool size', () => {
        const pool = makePlayers(4);
        render(<UnassignedBar pool={pool} onBarClick={mockOnBarClick} />);

        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument(); // count badge
    });

    it('shows overflow when pool > 6', () => {
        const pool = makePlayers(9);
        render(<UnassignedBar pool={pool} onBarClick={mockOnBarClick} />);

        expect(screen.getByText('+3')).toBeInTheDocument();
        expect(screen.getByText('9')).toBeInTheDocument();
    });

    it('shows "All players assigned ✓" when pool is empty', () => {
        render(<UnassignedBar pool={[]} onBarClick={mockOnBarClick} />);

        expect(screen.getByText('All players assigned ✓')).toBeInTheDocument();
    });

    it('calls onBarClick when clicked', () => {
        const pool = makePlayers(3);
        render(<UnassignedBar pool={pool} onBarClick={mockOnBarClick} />);

        fireEvent.click(screen.getByText('Unassigned'));
        expect(mockOnBarClick).toHaveBeenCalledOnce();
    });

    it('is accessible with aria-label', () => {
        const pool = makePlayers(5);
        render(<UnassignedBar pool={pool} onBarClick={mockOnBarClick} />);

        const bar = screen.getByRole('button');
        expect(bar).toHaveAttribute('aria-label', '5 unassigned players. Click to view.');
    });

    it('sorts pool alphabetically by username (case-insensitive)', () => {
        const unsortedPool: RosterAssignmentResponse[] = [
            {
                id: 3,
                signupId: 3,
                userId: 103,
                discordId: '103',
                username: 'charlie',
                avatar: null,
                slot: null,
                position: 0,
                isOverride: false,
                character: null,
            },
            {
                id: 1,
                signupId: 1,
                userId: 101,
                discordId: '101',
                username: 'alice',
                avatar: null,
                slot: null,
                position: 0,
                isOverride: false,
                character: null,
            },
            {
                id: 2,
                signupId: 2,
                userId: 102,
                discordId: '102',
                username: 'Bob',
                avatar: null,
                slot: null,
                position: 0,
                isOverride: false,
                character: null,
            },
        ];

        const { container } = render(<UnassignedBar pool={unsortedPool} onBarClick={mockOnBarClick} />);
        const avatars = container.querySelectorAll('.unassigned-bar__avatar');

        // Should be sorted: alice, Bob, charlie (case-insensitive)
        // Verify by checking the initials fallback text
        expect(avatars[0]).toHaveTextContent('A');
        expect(avatars[1]).toHaveTextContent('B');
        expect(avatars[2]).toHaveTextContent('C');
    });

    it('does not mutate the original pool array', () => {
        const pool: RosterAssignmentResponse[] = [
            {
                id: 2,
                signupId: 2,
                userId: 102,
                discordId: '102',
                username: 'zebra',
                avatar: null,
                slot: null,
                position: 0,
                isOverride: false,
                character: null,
            },
            {
                id: 1,
                signupId: 1,
                userId: 101,
                discordId: '101',
                username: 'aardvark',
                avatar: null,
                slot: null,
                position: 0,
                isOverride: false,
                character: null,
            },
        ];

        const originalOrder = pool.map((p) => p.username);
        render(<UnassignedBar pool={pool} onBarClick={mockOnBarClick} />);

        // Original array should remain unchanged
        expect(pool[0].username).toBe(originalOrder[0]);
        expect(pool[1].username).toBe(originalOrder[1]);
    });
});
