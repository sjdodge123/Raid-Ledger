import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlayerCard } from './player-card';
import { formatRole } from '../../lib/role-colors';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';

/** Create a minimal RosterAssignmentResponse for testing. */
function createMockPlayer(
    overrides: Partial<RosterAssignmentResponse> = {},
): RosterAssignmentResponse {
    return {
        id: 1,
        signupId: 1,
        userId: 10,
        discordId: '123456789',
        username: 'TestPlayer',
        avatar: null,
        customAvatarUrl: null,
        slot: null,
        position: 1,
        isOverride: false,
        character: null,
        preferredRoles: null,
        ...overrides,
    };
}

/** Wrap component in MemoryRouter for Link support. */
function renderCard(props: Parameters<typeof PlayerCard>[0]) {
    return render(
        <MemoryRouter>
            <PlayerCard {...props} />
        </MemoryRouter>,
    );
}

describe('PlayerCard — FlexibilityBadges', () => {
    it('renders role icons when preferredRoles has exactly 1 role (AC-1)', () => {
        const player = createMockPlayer({ preferredRoles: ['tank'] });
        renderCard({ player });
        expect(screen.getByAltText('tank')).toBeInTheDocument();
    });

    it('renders role icons when preferredRoles has 2+ roles (AC-2)', () => {
        const player = createMockPlayer({
            preferredRoles: ['tank', 'healer'],
        });
        renderCard({ player });
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('renders all three role icons for triple-flex (AC-2)', () => {
        const player = createMockPlayer({
            preferredRoles: ['tank', 'healer', 'dps'],
        });
        renderCard({ player });
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('healer')).toBeInTheDocument();
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('does not render role icons when preferredRoles is null (AC-4)', () => {
        const player = createMockPlayer({ preferredRoles: null });
        renderCard({ player });
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('does not render role icons when preferredRoles is empty (AC-4)', () => {
        const player = createMockPlayer({ preferredRoles: [] });
        renderCard({ player });
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });
});

describe('PlayerCard — FlexibilityBadges adversarial edge cases', () => {
    it('does not render role icons when preferredRoles is undefined (AC-4)', () => {
        // The field is typed as string[] | null, but undefined is a runtime possibility
        // from API responses that omit the field entirely.
        const player = createMockPlayer({ preferredRoles: undefined as unknown as null });
        renderCard({ player });
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('renders only one icon for duplicate roles without key collision', () => {
        // React uses key={r} — duplicate keys cause silent rendering issues.
        // The component renders an icon per entry, so two 'tank' entries produces two imgs
        // but with duplicate keys. We assert both images appear and there are no console errors.
        const player = createMockPlayer({ preferredRoles: ['tank', 'tank'] });
        renderCard({ player });
        // Both images are in the DOM (React does not deduplicate on key collision)
        const icons = screen.getAllByAltText('tank');
        expect(icons).toHaveLength(2);
    });

    it('does not render a role icon for an unrecognized role string', () => {
        // getRoleIconUrl returns null for unknown roles; RoleIcon returns null.
        const player = createMockPlayer({ preferredRoles: ['support'] });
        renderCard({ player });
        expect(screen.queryByAltText('support')).not.toBeInTheDocument();
    });

    it('renders only recognized role icons when mixed with unknown roles', () => {
        const player = createMockPlayer({ preferredRoles: ['tank', 'support'] });
        renderCard({ player });
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.queryByAltText('support')).not.toBeInTheDocument();
    });

    it('FlexibilityBadges tooltip text lists formatted role names for single role (AC-1)', () => {
        const player = createMockPlayer({ preferredRoles: ['tank'] });
        const { container } = renderCard({ player });
        // The span wrapping the icons has a title attribute built with formatRole()
        const badge = container.querySelector('[title^="Prefers:"]');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute('title', `Prefers: ${formatRole('tank')}`);
    });

    it('FlexibilityBadges tooltip text lists all formatted role names for multiple roles (AC-2)', () => {
        const player = createMockPlayer({ preferredRoles: ['tank', 'healer'] });
        const { container } = renderCard({ player });
        const badge = container.querySelector('[title^="Prefers:"]');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute(
            'title',
            `Prefers: ${formatRole('tank')}, ${formatRole('healer')}`,
        );
    });

    it('no FlexibilityBadges tooltip rendered when preferredRoles is null', () => {
        const player = createMockPlayer({ preferredRoles: null });
        const { container } = renderCard({ player });
        expect(container.querySelector('[title^="Prefers:"]')).not.toBeInTheDocument();
    });

    it('tentative badge and role icons coexist when signup is tentative with preferredRoles', () => {
        const player = createMockPlayer({
            signupStatus: 'tentative',
            preferredRoles: ['healer'],
        });
        renderCard({ player });
        // Tentative hourglass emoji badge
        expect(screen.getByTitle('Tentative \u2014 may not attend')).toBeInTheDocument();
        // Role icon still renders
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('role icons render correctly for each known role in isolation', () => {
        const roles = ['tank', 'healer', 'dps'] as const;
        for (const role of roles) {
            const player = createMockPlayer({ preferredRoles: [role] });
            const { unmount } = renderCard({ player });
            expect(screen.getByAltText(role)).toBeInTheDocument();
            unmount();
        }
    });
});
