/**
 * Unit tests for RosterSlot keyboard accessibility (ROK-881).
 * Verifies that clickable slots are keyboard-navigable: since TDB:1949 the slot
 * action is a native <button> (tabbable, Enter/Space) beside the card, not a
 * role="button" div around it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    it('is a native, tabbable button when clickable (empty + onJoinClick)', () => {
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={vi.fn()}
            />,
        );
        const slot = screen.getByRole('button', { name: 'Join tank slot 1' });
        expect(slot.tagName).toBe('BUTTON');
        expect(slot.tabIndex).toBe(0);
    });

    it('is a native, tabbable button when admin-clickable with item', () => {
        render(
            <RosterSlot
                role="tank"
                position={1}
                item={createAssignment()}
                color="bg-blue-500"
                onAdminClick={vi.fn()}
            />,
        );
        const slot = screen.getByRole('button', { name: 'Manage tank slot 1 (Player1)' });
        expect(slot.tagName).toBe('BUTTON');
        expect(slot.tabIndex).toBe(0);
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

    it('fires onJoinClick on Enter key for empty clickable slot', async () => {
        const onJoinClick = vi.fn();
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={onJoinClick}
            />,
        );
        screen.getByRole('button').focus();
        await userEvent.setup().keyboard('{Enter}');
        expect(onJoinClick).toHaveBeenCalledWith('tank', 1);
    });

    it('fires onJoinClick on Space key for empty clickable slot', async () => {
        const onJoinClick = vi.fn();
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={onJoinClick}
            />,
        );
        screen.getByRole('button').focus();
        await userEvent.setup().keyboard(' ');
        expect(onJoinClick).toHaveBeenCalledWith('tank', 1);
    });

    it('fires onAdminClick on Enter key for admin-clickable slot', async () => {
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
        screen.getByRole('button').focus();
        await userEvent.setup().keyboard('{Enter}');
        expect(onAdminClick).toHaveBeenCalledWith('healer', 2);
    });

    it('has focus-visible ring class when clickable', () => {
        render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={vi.fn()}
            />,
        );
        expect(screen.getByRole('button').className).toContain('focus-visible:ring-2');
    });
});

describe('RosterSlot — departed signup treatment (ROK-1237)', () => {
    it('renders departed assignments with the dimmed red border and door glyph', () => {
        const { container } = render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                item={createAssignment({ signupStatus: 'departed' })}
            />,
        );
        const slot = container.querySelector('.rounded-lg');
        expect(slot?.className).toContain('border-red-500/40');
        expect(slot?.className).toContain('opacity-60');
        // Door glyph (U+1F6AA) replaces the bare position number so the row
        // visually parallels the EventDetailRoster departed group.
        expect(container.textContent).toContain('\u{1F6AA}');
    });

    it('does not apply the current-user pulse glow when the slot is departed', () => {
        const { container } = render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                item={createAssignment({ signupStatus: 'departed' })}
                isCurrentUser
            />,
        );
        const slot = container.querySelector('.rounded-lg');
        expect(slot?.className ?? '').not.toContain('animate-pulse-subtle');
    });
});
