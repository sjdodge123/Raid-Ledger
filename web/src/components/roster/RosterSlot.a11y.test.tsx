/**
 * Accessibility (axe-core) tests for RosterSlot (ROK-881).
 * Tests empty, filled, and clickable states for a11y violations.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { RosterSlot } from './RosterSlot';

vi.mock('./RosterCard', () => ({
    RosterCard: ({ item }: { item: { username: string } }) => (
        <div>{item.username}</div>
    ),
}));

function createAssignment() {
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
    };
}

describe('RosterSlot — axe accessibility (ROK-881)', () => {
    it('empty non-clickable slot has no violations', async () => {
        const { container } = render(
            <RosterSlot role="tank" position={1} color="bg-blue-500" />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });

    it('empty clickable slot has no violations', async () => {
        const { container } = render(
            <RosterSlot
                role="tank"
                position={1}
                color="bg-blue-500"
                onJoinClick={vi.fn()}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });

    it('filled slot with admin click has no violations', async () => {
        const { container } = render(
            <RosterSlot
                role="healer"
                position={2}
                item={createAssignment()}
                color="bg-green-500"
                onAdminClick={vi.fn()}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
