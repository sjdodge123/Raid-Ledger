/**
 * Unit tests for the ProfileSidebar (ROK-548).
 * Verifies restructured nav with new sections and user-specific links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileSidebar } from './profile-sidebar';

vi.mock('../../hooks/use-onboarding-fte', () => ({
    useResetOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: [] } }),
}));

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

function renderSidebar(initialPath = '/profile/avatar') {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <ProfileSidebar />
        </MemoryRouter>,
    );
}

describe('ProfileSidebar (ROK-548)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { id: 42 } });
    });

    it('renders the profile navigation landmark', () => {
        renderSidebar();
        expect(screen.getByRole('navigation', { name: /profile navigation/i })).toBeInTheDocument();
    });

    it('renders My Profile link pointing to /users/{userId}', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /my profile/i });
        expect(link).toHaveAttribute('href', '/users/42');
    });

    it('renders My Avatar link pointing to /profile/avatar', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /my avatar/i });
        expect(link).toHaveAttribute('href', '/profile/avatar');
    });

    it('renders My Integrations link pointing to /profile/integrations', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /my integrations/i });
        expect(link).toHaveAttribute('href', '/profile/integrations');
    });

    it('renders Preferences link pointing to /profile/preferences', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /preferences/i });
        expect(link).toHaveAttribute('href', '/profile/preferences');
    });

    it('renders Notifications link under Preferences section', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /notifications/i });
        expect(link).toHaveAttribute('href', '/profile/notifications');
    });

    it('renders gaming sub-items', () => {
        renderSidebar();
        expect(screen.getByRole('link', { name: /game time/i })).toHaveAttribute('href', '/profile/gaming/game-time');
        expect(screen.getByRole('link', { name: /characters/i })).toHaveAttribute('href', '/profile/gaming/characters');
        expect(screen.getByRole('link', { name: /watched games/i })).toHaveAttribute('href', '/profile/gaming/watched-games');
    });

    it('renders Delete Account link pointing to /profile/account', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /delete account/i });
        expect(link).toHaveAttribute('href', '/profile/account');
    });

    it('shows section labels including Integrations and Account', () => {
        renderSidebar();
        expect(screen.getAllByText('Identity').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Integrations').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Preferences').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Gaming').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1);
    });

    it('does not have links to old /profile/identity path', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        const hrefs = links.map((l) => l.getAttribute('href'));
        expect(hrefs).not.toContain('/profile/identity');
    });

    it('renders Re-run Setup Wizard button', () => {
        renderSidebar();
        expect(screen.getByRole('button', { name: /re-run setup wizard/i })).toBeInTheDocument();
    });

    it('renders without crashing when user is null (userId falls back to 0)', () => {
        mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
        expect(() => renderSidebar()).not.toThrow();
        // My Profile link still renders but points to /users/0
        expect(screen.getByRole('link', { name: /my profile/i })).toHaveAttribute('href', '/users/0');
    });

    it('active link for current path has active styling', () => {
        renderSidebar('/profile/avatar');
        const avatarLink = screen.getByRole('link', { name: /my avatar/i });
        expect(avatarLink.className).toContain('emerald');
    });

    it('inactive links do not have active emerald-background styling', () => {
        renderSidebar('/profile/avatar');
        const integrationsLink = screen.getByRole('link', { name: /my integrations/i });
        // Inactive links use 'text-muted' not the active emerald combination
        expect(integrationsLink.className).toContain('text-muted');
    });
});
