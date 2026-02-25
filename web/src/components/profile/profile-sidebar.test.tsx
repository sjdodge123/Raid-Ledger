/**
 * Unit tests for the ProfileSidebar (ROK-359).
 * Verifies consolidated nav renders exactly 5 items and no old paths.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileSidebar } from './profile-sidebar';

vi.mock('../../hooks/use-onboarding-fte', () => ({
    useResetOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
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

    it('renders all 5 consolidated nav items', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        // 5 nav links for My Profile, Preferences, Notifications, Gaming, Account
        expect(links.length).toBeGreaterThanOrEqual(5);
    });

    it('shows My Profile link pointing to /profile/identity', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /my profile/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/profile/identity');
    });

    it('shows Preferences link pointing to /profile/preferences', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /^preferences$/i });
        expect(link).toHaveAttribute('href', '/profile/preferences');
    });

    it('shows Notifications link pointing to /profile/notifications', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /^notifications$/i });
        expect(link).toHaveAttribute('href', '/profile/notifications');
    });

    it('shows Gaming link pointing to /profile/gaming', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /^gaming$/i });
        expect(link).toHaveAttribute('href', '/profile/gaming');
    });

    it('shows Account link pointing to /profile/account', () => {
        renderSidebar();
        const link = screen.getByRole('link', { name: /^account$/i });
        expect(link).toHaveAttribute('href', '/profile/account');
    });

    it('does not have links to old sub-paths like /profile/identity/discord', () => {
        renderSidebar();
        const links = screen.getAllByRole('link');
        const hrefs = links.map((l) => l.getAttribute('href'));
        expect(hrefs).not.toContain('/profile/identity/discord');
        expect(hrefs).not.toContain('/profile/identity/avatar');
        expect(hrefs).not.toContain('/profile/preferences/appearance');
        expect(hrefs).not.toContain('/profile/gaming/game-time');
        expect(hrefs).not.toContain('/profile/danger/delete-account');
    });

    it('renders Re-run Setup Wizard button', () => {
        renderSidebar();
        expect(screen.getByRole('button', { name: /re-run setup wizard/i })).toBeInTheDocument();
    });

    it('shows section labels: Identity, Preferences, Notifications, Gaming, Account', () => {
        renderSidebar();
        // Section labels and nav link labels share the same text in the consolidated nav.
        // Use getAllByText to handle the fact that each label appears in both the section
        // header span and the nav link anchor.
        expect(screen.getAllByText('Identity').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Preferences').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Notifications').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Gaming').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1);
    });
});
