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
