/**
 * Unit tests for the ProfileSidebar (ROK-359).
 * Verifies consolidated nav renders the correct items and no old paths.
 * Account/danger zone is consolidated into the Identity panel.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileSidebar } from './profile-sidebar';

vi.mock('../../hooks/use-onboarding-fte', () => ({
    useResetOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: [] } }),
}));

function renderSidebar(initialPath = '/profile/identity') {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <ProfileSidebar />
        </MemoryRouter>,
    );
}

describe('ProfileSidebar (ROK-359)', () => {
    it('renders the profile navigation landmark', () => {
        renderSidebar();
        expect(screen.getByRole('navigation', { name: /profile navigation/i })).toBeInTheDocument();
    });

    it('renders nav items including gaming sub-items', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        // My Profile, Preferences, Notifications, Game Time, Characters, Watched Games = 6
        expect(links.length).toBeGreaterThanOrEqual(6);
    });

    it('shows My Profile link pointing to /profile/identity', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /my profile/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/profile/identity');
    });

    it('shows Game Time link pointing to /profile/gaming/game-time', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /game time/i });
        expect(link).toHaveAttribute('href', '/profile/gaming/game-time');
    });

    it('shows Characters link pointing to /profile/gaming/characters', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /characters/i });
        expect(link).toHaveAttribute('href', '/profile/gaming/characters');
    });

    it('shows Watched Games link pointing to /profile/gaming/watched-games', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /watched games/i });
        expect(link).toHaveAttribute('href', '/profile/gaming/watched-games');
    });

    it('does not show separate Account link (consolidated into Identity)', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        const hrefs = links.map((l) => l.getAttribute('href'));
        expect(hrefs).not.toContain('/profile/account');
    });

    it('does not have links to old sub-paths like /profile/identity/discord', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        const hrefs = links.map((l) => l.getAttribute('href'));
        expect(hrefs).not.toContain('/profile/identity/discord');
        expect(hrefs).not.toContain('/profile/identity/avatar');
        expect(hrefs).not.toContain('/profile/preferences/appearance');
        expect(hrefs).not.toContain('/profile/danger/delete-account');
    });

    it('renders Re-run Setup Wizard button', () => {
        renderSidebar();
        expect(screen.getByRole('button', { name: /re-run setup wizard/i })).toBeInTheDocument();
    });

    it('shows section labels: Identity, Preferences, Notifications, Gaming', () => {
        renderSidebar();
        expect(screen.getAllByText('Identity').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Preferences').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Notifications').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Gaming').length).toBeGreaterThanOrEqual(1);
    });
});
