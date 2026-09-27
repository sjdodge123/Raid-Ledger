import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

describe('EventDetailRoster — rendering paths per signup group', () => {
    it('does not render role icons when preferredRoles is undefined (AC-4)', () => {
        const signup = createSignup({ preferredRoles: undefined as unknown as null });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('renders role icons through ConfirmedGroup path (non-anonymous confirmed signup)', () => {
        const signup = createSignup({
            confirmationStatus: 'confirmed',
            preferredRoles: ['tank', 'dps'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('tank')).toBeInTheDocument();
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('renders role icons through TentativeGroup/SignupEntry path', () => {
        const signup = createSignup({
            status: 'tentative',
            preferredRoles: ['healer', 'dps'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.getByAltText('healer')).toBeInTheDocument();
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('does NOT render role icons in the Pending group', () => {
        const signup = createSignup({
            status: 'signed_up',
            confirmationStatus: 'pending',
            preferredRoles: ['tank'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
    });

    it('does NOT render role icons in the Departed group', () => {
        const signup = createSignup({
            status: 'departed',
            preferredRoles: ['healer'],
        });
        renderRoster(createRoster([signup]));
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
    });
});

describe('EventDetailRoster — boundary inputs & multiple signups', () => {
    it('renders correct count of role icons for duplicate roles', () => {
        const signup = createSignup({ preferredRoles: ['dps', 'dps'] });
        renderRoster(createRoster([signup]));
        const icons = screen.getAllByAltText('dps');
        expect(icons).toHaveLength(2);
    });

    it('does not render an icon for an unrecognized role string', () => {
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

describe('EventDetailRoster — running-late badge (ROK-1379 follow-up)', () => {
    it('renders the ⏰ late badge for a confirmed signup marked running late', () => {
        const signup = createSignup({ runningLate: true });
        renderRoster(createRoster([signup]));
        expect(screen.getByTitle('Running late')).toBeInTheDocument();
        expect(screen.getByTitle('Running late')).toHaveTextContent('late');
    });

    it('includes minutes in the badge when lateMinutes is set', () => {
        const signup = createSignup({ runningLate: true, lateMinutes: 15 });
        renderRoster(createRoster([signup]));
        expect(screen.getByTitle('Running late (+15 min)')).toHaveTextContent('+15m');
    });

    it('renders the badge for a tentative signup marked running late', () => {
        const signup = createSignup({ status: 'tentative' as const, runningLate: true });
        renderRoster(createRoster([signup]));
        expect(screen.getByTitle('Running late')).toBeInTheDocument();
    });

    it('renders the badge in the Pending group', () => {
        const signup = createSignup({ confirmationStatus: 'pending' as const, runningLate: true });
        renderRoster(createRoster([signup]));
        expect(screen.getByText('Pending (1)')).toBeInTheDocument();
        expect(screen.getByTitle('Running late')).toBeInTheDocument();
    });

    it('does not render the badge when runningLate is false or undefined', () => {
        renderRoster(createRoster([createSignup({ runningLate: false }), createSignup({ id: 2 })]));
        expect(screen.queryByTitle(/Running late/)).not.toBeInTheDocument();
    });
});

/** ROK-1694: an anonymous Discord signup (user_id NULL) — the API sends user.id 0. */
function createAnonymousSignup(overrides: Record<string, unknown> = {}) {
    return createSignup({
        id: 99,
        user: { id: 0, username: 'DiscordGuy', avatar: null, discordId: '999' },
        isAnonymous: true,
        discordUsername: 'DiscordGuy',
        ...overrides,
    });
}

function profileLinksTo(container: HTMLElement, userId: number) {
    return container.querySelectorAll(`a[href="/users/${userId}"]`);
}

/** The ROK-381 guest route state a roster slot card passes for the same account-less signup. */
const GUEST_STATE = { guest: true, username: 'DiscordGuy', discordId: '999', avatarHash: null };

function ProfileProbe() {
    const location = useLocation();
    return (
        <>
            <div data-testid="probe-path">{location.pathname}</div>
            <div data-testid="probe-state">{JSON.stringify(location.state ?? null)}</div>
        </>
    );
}

function renderRosterWithProfileRoute(roster: EventRosterDto) {
    return render(
        <MemoryRouter initialEntries={['/events/1']}>
            <Routes>
                <Route path="/events/1" element={<EventDetailRoster roster={roster} event={createMockEvent()} />} />
                <Route path="/users/:id" element={<ProfileProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

/** Follow the anonymous row's link; return where it landed (path + ROK-381 guest state). */
function followAnonymousRowLink(signup: ReturnType<typeof createSignup>) {
    const { container } = renderRosterWithProfileRoute(createRoster([signup]));
    const links = profileLinksTo(container, 0);
    expect(links, 'an anonymous roster row must link to the ROK-381 guest profile (/users/0)').toHaveLength(1);
    const link = links[0] as HTMLElement;
    expect(within(link).queryByText('DiscordGuy'), 'the Discord name renders inside the link').not.toBeNull();
    expect(within(link).queryByText('via Discord'), 'the "via Discord" chip renders inside the link').not.toBeNull();
    expect(link.querySelector('a, button'), 'no interactive element nested inside the link').toBeNull();
    fireEvent.click(link);
    return {
        path: screen.getByTestId('probe-path').textContent,
        state: JSON.parse(screen.getByTestId('probe-state').textContent ?? 'null') as unknown,
    };
}

// Operator ruling 2026-09-27 (ROK-1694 Option B): list rows link an account-less Discord signup to the
// SAME ROK-381 guest profile the slot cards use. Supersedes the old "no roster surface links to /users/0" AC.
describe('EventDetailRoster — anonymous Discord signups (ROK-1694)', () => {
    it('a CONFIRMED anonymous row renders name + "via Discord" chip inside the ROK-381 guest-profile link', () => {
        const landed = followAnonymousRowLink(createAnonymousSignup());
        expect(landed).toEqual({ path: '/users/0', state: GUEST_STATE });
    });

    it('a pending anonymous signup (routed to Confirmed) links to the guest profile too', () => {
        const landed = followAnonymousRowLink(createAnonymousSignup({ confirmationStatus: 'pending' }));
        expect(landed).toEqual({ path: '/users/0', state: GUEST_STATE });
    });

    it('a TENTATIVE anonymous row links to the guest profile with the chip', () => {
        const landed = followAnonymousRowLink(createAnonymousSignup({ status: 'tentative' }));
        expect(landed).toEqual({ path: '/users/0', state: GUEST_STATE });
    });

    it('a DEPARTED anonymous row links to the guest profile with the chip', () => {
        const landed = followAnonymousRowLink(createAnonymousSignup({ status: 'departed' }));
        expect(landed).toEqual({ path: '/users/0', state: GUEST_STATE });
    });

    it('keeps role icons for a confirmed anonymous signup', () => {
        renderRoster(createRoster([createAnonymousSignup({ preferredRoles: ['healer'] })]));
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });

    it('every group links anonymous rows to the guest profile, while a member still links to /users/<id>', () => {
        const signups = [
            createAnonymousSignup({ id: 91 }),
            createAnonymousSignup({ id: 92, status: 'tentative' }),
            createAnonymousSignup({ id: 93, status: 'departed' }),
            createSignup({ id: 94 }),
        ];
        const { container } = renderRoster(createRoster(signups));
        const guestLinks = [...profileLinksTo(container, 0)];
        expect(guestLinks, 'Confirmed, Tentative and Departed anonymous rows each link to /users/0').toHaveLength(3);
        guestLinks.forEach((a) => expect(within(a as HTMLElement).queryByText('via Discord')).not.toBeNull());
        expect(profileLinksTo(container, 10), 'the member links to their own profile').toHaveLength(1);
    });
});
