/**
 * Unit tests for RosterSlot keyboard accessibility (ROK-881).
 * Verifies that clickable slots are keyboard-navigable with
 * role="button", tabIndex, and Enter/Space handlers.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterSlot } from './RosterSlot';

// Mock RosterCard to avoid pulling in the full dependency tree
vi.mock('./RosterCard', () => ({
    RosterCard: ({ item }: { item: { username: string } }) => (
        <div data-testid="roster-card">{item.username}</div>
    ),
}));

function createAssignment(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        signupId: 100,
        userId: 10,
        discordId: 'disc-10',
        username: 'Player1',
        avatar: null,
        slot: 'tank',
        position: 1,
        isOverride: false,
        character: null,
        signupStatus: 'confirmed' as const,
        ...overrides,
    };
}

describe('RosterSlot — keyboard accessibility (ROK-881)', () => {
    it('has role="button" and tabIndex when clickable (empty + onJoinClick)', () => {
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={vi.fn()}
            />,
        );
        const slot = screen.getByRole('button');
        expect(slot).toHaveAttribute('tabindex', '0');
    });

    it('has role="button" and tabIndex when admin-clickable with item', () => {
        render(
            <RosterSlot
                role="tank"
                position={1}
                item={createAssignment()}
                color="bg-blue-500"
                onAdminClick={vi.fn()}
            />,
        );
        const slot = screen.getByRole('button');
        expect(slot).toHaveAttribute('tabindex', '0');
    });

    it('does NOT have role="button" when not clickable', () => {
        const { container } = render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
            />,
        );
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        const slot = container.querySelector('.rounded-lg');
        expect(slot).not.toHaveAttribute('tabindex');
    });

    it('fires onJoinClick on Enter key for empty clickable slot', () => {
        const onJoinClick = vi.fn();
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={onJoinClick}
            />,
        );
        const slot = screen.getByRole('button');
        fireEvent.keyDown(slot, { key: 'Enter' });
        expect(onJoinClick).toHaveBeenCalledWith('tank', 1);
    });

    it('fires onJoinClick on Space key for empty clickable slot', () => {
        const onJoinClick = vi.fn();
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={onJoinClick}
            />,
        );
        const slot = screen.getByRole('button');
        fireEvent.keyDown(slot, { key: ' ' });
        expect(onJoinClick).toHaveBeenCalledWith('tank', 1);
    });

    it('fires onAdminClick on Enter key for admin-clickable slot', () => {
        const onAdminClick = vi.fn();
        render(
            <RosterSlot
                role="healer"
                position={2}
                item={createAssignment()}
                color="bg-green-500"
                onAdminClick={onAdminClick}
            />,
        );
        const slot = screen.getByRole('button');
        fireEvent.keyDown(slot, { key: 'Enter' });
        expect(onAdminClick).toHaveBeenCalledWith('healer', 2);
    });

    it('has focus-visible ring class when clickable', () => {
        const { container } = render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={vi.fn()}
            />,
        );
        const slot = container.querySelector('[role="button"]');
        expect(slot?.className).toContain('focus-visible:ring-2');
    });
});
