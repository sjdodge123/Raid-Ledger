import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PlayerCard } from './player-card';
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
