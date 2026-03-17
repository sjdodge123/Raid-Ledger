import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventDetailRoster } from './EventDetailRoster';
import { createMockEvent } from '../../test/factories';
import type { EventRosterDto } from '@raid-ledger/contract';

/** Create a minimal signup for testing. */
function createSignup(
    overrides: Record<string, unknown> = {},
) {
    return {
        id: 1,
        eventId: 1,
        user: {
            id: 10,
            username: 'TestPlayer',
            avatar: null,
            discordId: '123456789',
        },
        note: null,
        signedUpAt: '2026-03-01T10:00:00Z',
        characterId: null,
        character: null,
        confirmationStatus: 'confirmed' as const,
        status: 'signed_up' as const,
        preferredRoles: null,
        ...overrides,
    };
}

/** Build a roster DTO from signups. */
function createRoster(
    signups: ReturnType<typeof createSignup>[],
): EventRosterDto {
    return {
        eventId: 1,
        signups,
        count: signups.length,
    };
}

function renderRoster(
    roster: EventRosterDto,
    event = createMockEvent(),
) {
    return render(
        <MemoryRouter>
            <EventDetailRoster roster={roster} event={event} />
        </MemoryRouter>,
    );
}

describe('EventDetailRoster — role preference icons', () => {
    it('renders role icons for confirmed signup with preferredRoles (AC-3)', () => {
        const signup = createSignup({
            preferredRoles: ['tank', 'healer'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('renders single role icon for confirmed signup (AC-3)', () => {
        const signup = createSignup({ preferredRoles: ['dps'] });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('renders role icons for tentative signup (AC-3)', () => {
        const signup = createSignup({
            status: 'tentative',
            preferredRoles: ['healer'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('does not render role icons when preferredRoles is null (AC-4)', () => {
        const signup = createSignup({ preferredRoles: null });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('does not render role icons when preferredRoles is empty (AC-4)', () => {
        const signup = createSignup({ preferredRoles: [] });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });
});

describe('EventDetailRoster — adversarial edge cases', () => {
    it('does not render role icons when preferredRoles is undefined (AC-4)', () => {
        // Guard against API responses omitting the field entirely.
        const signup = createSignup({ preferredRoles: undefined as unknown as null });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('renders role icons through ConfirmedGroup path (non-anonymous confirmed signup)', () => {
        // ConfirmedGroup renders its own inline div (not SignupEntry).
        // This path must also pass preferredRoles to RolePreferenceBadges.
        const signup = createSignup({
            confirmationStatus: 'confirmed',
            preferredRoles: ['tank', 'dps'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('renders role icons through TentativeGroup/SignupEntry path', () => {
        // TentativeGroup delegates to SignupEntry, which calls RolePreferenceBadges.
        const signup = createSignup({
            status: 'tentative',
            preferredRoles: ['healer', 'dps'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('healer')).toBeInTheDocument();
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('does NOT render role icons in the Pending group (SimpleSignupGroup has no RolePreferenceBadges)', () => {
        // SimpleSignupGroup renders pending signups without role icons by design.
        const signup = createSignup({
            status: 'signed_up',
            confirmationStatus: 'pending',
            preferredRoles: ['tank'],
        });
        renderRoster(createRoster([signup]));
        // Pending group should show the player but NOT the role icon
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
    });

    it('does NOT render role icons in the Departed group', () => {
        // Departed signups go through SimpleSignupGroup which has no RolePreferenceBadges.
        const signup = createSignup({
            status: 'departed',
            preferredRoles: ['healer'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
    });

    it('renders correct count of role icons for duplicate roles', () => {
        // Duplicate roles produce one icon per entry (key collision, but React still renders both).
        const signup = createSignup({ preferredRoles: ['dps', 'dps'] });
        renderRoster(createRoster([signup]));
        const icons = screen.getAllByAltText('dps');
        expect(icons).toHaveLength(2);
    });

    it('does not render an icon for an unrecognized role string', () => {
        // getRoleIconUrl returns null for unknown roles; RoleIcon renders nothing.
        const signup = createSignup({ preferredRoles: ['support'] });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('support')).not.toBeInTheDocument();
    });

    it('renders recognized roles only when mixed with unknown roles', () => {
        const signup = createSignup({ preferredRoles: ['tank', 'support'] });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.queryByAltText('support')).not.toBeInTheDocument();
    });

    it('multiple confirmed signups each display their own role icons independently', () => {
        const signup1 = createSignup({ id: 1, preferredRoles: ['tank'] });
        const signup2 = createSignup({
            id: 2,
            user: { id: 11, username: 'Player2', avatar: null, discordId: null },
            preferredRoles: ['healer'],
        });
        renderRoster(createRoster([signup1, signup2]));
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('roster renders correctly when roster prop is undefined', () => {
        const event = createMockEvent();
        render(
            <MemoryRouter>
                <EventDetailRoster roster={undefined} event={event} />
            </MemoryRouter>,
        );
        expect(screen.getByText('Attendees (0)')).toBeInTheDocument();
    });

    it('renders empty state when signups array is empty', () => {
        renderRoster(createRoster([]));
        expect(screen.getByText(/No players signed up yet/i)).toBeInTheDocument();
    });
});
