import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

describe('PlayerCard — FlexibilityBadges boundary inputs', () => {
    it('does not render role icons when preferredRoles is undefined (AC-4)', () => {
        // The field is typed as string[] | null, but undefined is a runtime possibility
        // from API responses that omit the field entirely.
        const player = createMockPlayer({ preferredRoles: undefined as unknown as null });
        renderCard({ player });
        expect(screen.queryByAltText('tank')).not.toBeInTheDocument();
        expect(screen.queryByAltText('healer')).not.toBeInTheDocument();
        expect(screen.queryByAltText('dps')).not.toBeInTheDocument();
    });

    it('renders two icons for duplicate roles without key collision', () => {
        const player = createMockPlayer({ preferredRoles: ['tank', 'tank'] });
        renderCard({ player });
        const icons = screen.getAllByAltText('tank');
        expect(icons).toHaveLength(2);
    });

    it('does not render a role icon for an unrecognized role string', () => {
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

describe('PlayerCard — FlexibilityBadges tooltip & coexistence', () => {
    it('FlexibilityBadges tooltip text lists formatted role names for single role (AC-1)', () => {
        const player = createMockPlayer({ preferredRoles: ['tank'] });
        const { container } = renderCard({ player });
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
        expect(screen.getByTitle('Tentative \u2014 may not attend')).toBeInTheDocument();
        expect(screen.getByAltText('healer')).toBeInTheDocument();
    });
});

describe('PlayerCard — running-late badge (ROK-1379 follow-up)', () => {
    it('renders the ⏰ badge when the player is running late', () => {
        const player = createMockPlayer({ runningLate: true });
        renderCard({ player });
        expect(screen.getByTitle('Running late')).toBeInTheDocument();
    });

    it('shows minutes in the tooltip and badge when lateMinutes is set', () => {
        const player = createMockPlayer({ runningLate: true, lateMinutes: 15 });
        renderCard({ player });
        expect(screen.getByTitle('Running late (+15 min)')).toHaveTextContent('+15m');
    });

    it('does not render the badge when runningLate is absent', () => {
        renderCard({ player: createMockPlayer() });
        expect(screen.queryByTitle(/Running late/)).not.toBeInTheDocument();
    });

    it('running-late and tentative badges coexist', () => {
        const player = createMockPlayer({ runningLate: true, signupStatus: 'tentative' });
        renderCard({ player });
        expect(screen.getByTitle('Tentative — may not attend')).toBeInTheDocument();
        expect(screen.getByTitle('Running late')).toBeInTheDocument();
    });
});

function ProfileProbe() {
    const location = useLocation();
    return (
        <>
            <div data-testid="probe-path">{location.pathname}</div>
            <div data-testid="probe-state">{JSON.stringify(location.state ?? null)}</div>
        </>
    );
}

/** Render the card on a route, click its name link, and return where it landed. */
function followNameLink(player: RosterAssignmentResponse, href: string) {
    const { container } = render(
        <MemoryRouter initialEntries={['/events/1']}>
            <Routes>
                <Route path="/events/1" element={<PlayerCard player={player} />} />
                <Route path="/users/:id" element={<ProfileProbe />} />
            </Routes>
        </MemoryRouter>,
    );
    const links = container.querySelectorAll(`a[href="${href}"]`);
    expect(links, `the player name must link to ${href}`).toHaveLength(1);
    fireEvent.click(links[0]);
    return {
        path: screen.getByTestId('probe-path').textContent,
        state: JSON.parse(screen.getByTestId('probe-state').textContent ?? 'null') as unknown,
    };
}

// ROK-1694 Option B (operator ruling 2026-09-27): slot cards keep ROK-381's guest-profile link.
describe('PlayerCard — profile link (ROK-381 guest profile, ROK-1694)', () => {
    it('an account-less Discord signup (userId 0) links to the ROK-381 guest profile with guest state', () => {
        const player = createMockPlayer({ userId: 0, username: 'DiscordGuy', discordId: '999', avatar: null });
        expect(followNameLink(player, '/users/0')).toEqual({
            path: '/users/0',
            state: { guest: true, username: 'DiscordGuy', discordId: '999', avatarHash: null },
        });
    });

    it('a member links to /users/<id> with no guest state', () => {
        expect(followNameLink(createMockPlayer(), '/users/10')).toEqual({ path: '/users/10', state: null });
    });
});

/** Everything a keyboard or AT user can land on. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [tabindex]';

/** Interactive elements that sit inside another interactive element (axe `nested-interactive`). */
function nestedInteractive(container: HTMLElement) {
    return [...container.querySelectorAll(INTERACTIVE)]
        .filter((el) => el.parentElement?.closest(INTERACTIVE))
        .map((el) => `${el.tagName.toLowerCase()} "${el.textContent || el.getAttribute('aria-label')}"`);
}

/** A clickable, removable card on an event route, with the profile route mounted. */
function renderClickableCard() {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    const player = createMockPlayer({ signupStatus: 'tentative', preferredRoles: ['tank'] });
    const utils = render(
        <MemoryRouter initialEntries={['/events/1']}>
            <Routes>
                <Route path="/events/1" element={<PlayerCard player={player} size="compact" onClick={onClick} onRemove={onRemove} />} />
                <Route path="/users/:id" element={<ProfileProbe />} />
            </Routes>
        </MemoryRouter>,
    );
    return { ...utils, onClick, onRemove };
}

// TDB:1949 — the card action is a native button beside the link and Remove, never their ancestor.
describe('PlayerCard — clickable card (TDB:1949)', () => {
    it('no interactive element is nested inside another (axe nested-interactive)', async () => {
        const { container } = renderClickableCard();
        expect(nestedInteractive(container), 'controls nested inside another control').toEqual([]);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('clicking the card action fires onClick only', async () => {
        const { onClick, onRemove } = renderClickableCard();
        const action = screen.getByRole('button', { name: 'Select TestPlayer' });
        expect(action.tagName).toBe('BUTTON');
        await userEvent.click(action);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('Enter and Space on the focused card action fire onClick', async () => {
        const user = userEvent.setup();
        const { onClick } = renderClickableCard();
        screen.getByRole('button', { name: 'Select TestPlayer' }).focus();
        await user.keyboard('{Enter}');
        await user.keyboard(' ');
        expect(onClick).toHaveBeenCalledTimes(2);
    });

    it('Remove removes without firing onClick', async () => {
        const { onClick, onRemove } = renderClickableCard();
        await userEvent.click(screen.getByRole('button', { name: 'Remove TestPlayer from slot' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('the name link navigates to the profile without firing onClick', async () => {
        const { onClick } = renderClickableCard();
        await userEvent.click(screen.getByRole('link', { name: 'TestPlayer' }));
        expect(screen.getByTestId('probe-path')).toHaveTextContent('/users/10');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('uses clickLabel as the action name when given', () => {
        renderCard({ player: createMockPlayer(), onClick: vi.fn(), clickLabel: 'Assign TestPlayer' });
        expect(screen.getByRole('button', { name: 'Assign TestPlayer' })).toBeInTheDocument();
    });

    it('a non-clickable card renders no action button and raises nothing', () => {
        const { container } = renderCard({ player: createMockPlayer(), onRemove: vi.fn() });
        expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Remove TestPlayer from slot']);
        expect(container.querySelector('.relative'), 'non-clickable cards keep their original classes').toBeNull();
        expect(container.firstElementChild).toHaveClass('transition-all');
    });
});
