import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DiscordJoinBanner } from './DiscordJoinBanner';

// Mock hooks so we control them directly
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../../hooks/use-discord-membership', () => ({
    useDiscordMembership: vi.fn(),
}));

import { useAuth } from '../../hooks/use-auth';
import { useDiscordMembership } from '../../hooks/use-discord-membership';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseDiscordMembership = useDiscordMembership as ReturnType<typeof vi.fn>;

const DISMISS_KEY = 'discord-join-banner-dismissed';

/** Authenticated user with a real Discord ID */
const authWithDiscord = {
    isAuthenticated: true,
    user: {
        id: 1,
        username: 'testuser',
        discordId: '123456789',
        displayName: null,
        avatar: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
    },
};

/** Authenticated user WITHOUT a linked Discord account */
const authWithoutDiscord = {
    isAuthenticated: true,
    user: {
        id: 2,
        username: 'localuser',
        discordId: null,
        displayName: null,
        avatar: null,
        customAvatarUrl: null,
        role: 'member',
        onboardingCompletedAt: null,
    },
};

/** Default membership data: bot online, user not a member, invite available */
const notMemberData = {
    botConnected: true,
    guildName: 'Test Guild',
    isMember: false,
    inviteUrl: 'https://discord.gg/invite123',
};

const isMemberData = {
    botConnected: true,
    guildName: 'Test Guild',
    isMember: true,
};

const botOfflineData = {
    botConnected: false,
};

function renderBanner(route = '/events') {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <DiscordJoinBanner />
        </MemoryRouter>,
    );
}

describe('DiscordJoinBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();

        // Sensible defaults: authenticated with Discord, bot online, not a member
        mockUseAuth.mockReturnValue(authWithDiscord);
        mockUseDiscordMembership.mockReturnValue({ data: notMemberData });
    });

    afterEach(() => {
        localStorage.clear();
    });

    // =========================================================
    // Visibility — SHOULD show banner
    // =========================================================

    describe('renders the banner', () => {
        it('shows banner for authenticated user not in the guild', () => {
            renderBanner('/events');

            expect(
                screen.getByText(/You're not in the/),
            ).toBeInTheDocument();
        });

        it('shows the guild name in the banner text', () => {
            renderBanner('/events');

            expect(screen.getByText('Test Guild')).toBeInTheDocument();
        });

        it('renders the "Join Server" button with correct href', () => {
            renderBanner('/events');

            const link = screen.getByRole('link', { name: 'Join Server' });
            expect(link).toBeInTheDocument();
            expect(link).toHaveAttribute('href', 'https://discord.gg/invite123');
        });

        it('opens the invite link in a new tab', () => {
            renderBanner('/events');

            const link = screen.getByRole('link', { name: 'Join Server' });
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });

        it('renders a dismiss button with accessible label', () => {
            renderBanner('/events');

            expect(
                screen.getByRole('button', {
                    name: 'Dismiss Discord join banner',
                }),
            ).toBeInTheDocument();
        });

        it('does NOT show "Join Server" button when inviteUrl is missing', () => {
            mockUseDiscordMembership.mockReturnValue({
                data: { botConnected: true, guildName: 'Test Guild', isMember: false },
            });
            renderBanner('/events');

            expect(
                screen.queryByRole('link', { name: 'Join Server' }),
            ).not.toBeInTheDocument();
            // Banner itself is still shown
            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });
    });

    // =========================================================
    // Visibility — SHOULD NOT show banner
    // =========================================================

    describe('hidden conditions', () => {
        it('is hidden when the user is NOT authenticated', () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });

        it('is hidden when user has no Discord account linked (discordId is null)', () => {
            mockUseAuth.mockReturnValue(authWithoutDiscord);

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });

        it('is hidden when the bot is offline (botConnected: false)', () => {
            mockUseDiscordMembership.mockReturnValue({ data: botOfflineData });

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });

        it('is hidden when the user IS already a member of the guild', () => {
            mockUseDiscordMembership.mockReturnValue({ data: isMemberData });

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });

        it('is hidden when membership data has not loaded yet (data is undefined)', () => {
            mockUseDiscordMembership.mockReturnValue({ data: undefined });

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });
    });

    // =========================================================
    // Route suppression
    // =========================================================

    describe('route suppression', () => {
        it('is NOT shown on the root path ("/")', () => {
            const { container } = renderBanner('/');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /login', () => {
            const { container } = renderBanner('/login');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /auth/success', () => {
            const { container } = renderBanner('/auth/success');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /join', () => {
            const { container } = renderBanner('/join');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on PUG claim flow (/i/:code)', () => {
            const { container } = renderBanner('/i/abc123');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on any /i/* path', () => {
            const { container } = renderBanner('/i/some-pug-code');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /onboarding', () => {
            const { container } = renderBanner('/onboarding');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /onboarding/* sub-routes', () => {
            const { container } = renderBanner('/onboarding/character');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /admin/setup', () => {
            const { container } = renderBanner('/admin/setup');
            expect(container.firstChild).toBeNull();
        });

        it('is NOT shown on /admin/setup/* sub-routes', () => {
            const { container } = renderBanner('/admin/setup/step-2');
            expect(container.firstChild).toBeNull();
        });

        it('IS shown on a normal app route (/events)', () => {
            renderBanner('/events');
            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });

        it('IS shown on /players', () => {
            renderBanner('/players');
            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });

        it('IS shown on /profile', () => {
            renderBanner('/profile');
            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });

        it('IS shown on /admin (not /admin/setup)', () => {
            renderBanner('/admin');
            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });
    });

    // =========================================================
    // Dismiss behavior
    // =========================================================

    describe('dismiss behavior', () => {
        it('hides the banner when the dismiss button is clicked', () => {
            renderBanner('/events');

            const btn = screen.getByRole('button', {
                name: 'Dismiss Discord join banner',
            });
            fireEvent.click(btn);

            expect(
                screen.queryByText(/You're not in the/),
            ).not.toBeInTheDocument();
        });

        it('persists dismissal in localStorage', () => {
            renderBanner('/events');

            const btn = screen.getByRole('button', {
                name: 'Dismiss Discord join banner',
            });
            fireEvent.click(btn);

            expect(localStorage.getItem(DISMISS_KEY)).toBe('true');
        });

        it('reads dismissed state from localStorage on mount and hides banner', () => {
            localStorage.setItem(DISMISS_KEY, 'true');

            const { container } = renderBanner('/events');

            expect(container.firstChild).toBeNull();
        });

        it('shows the banner when localStorage dismiss key is absent', () => {
            // localStorage is cleared in beforeEach — key is absent
            renderBanner('/events');

            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });

        it('shows the banner when localStorage dismiss value is not "true"', () => {
            localStorage.setItem(DISMISS_KEY, 'false');

            renderBanner('/events');

            expect(screen.getByText(/You're not in the/)).toBeInTheDocument();
        });
    });

    // =========================================================
    // Edge cases
    // =========================================================

    describe('edge cases', () => {
        it('does not crash when guildName is undefined', () => {
            mockUseDiscordMembership.mockReturnValue({
                data: { botConnected: true, isMember: false, inviteUrl: undefined },
            });

            // Should render something (banner is visible because guildName can be falsy
            // but banner still shows; the text just omits the guild name)
            expect(() => renderBanner('/events')).not.toThrow();
        });

        it('does not crash when user is null but isAuthenticated is false', () => {
            mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });

            expect(() => renderBanner('/events')).not.toThrow();
        });
    });
});
