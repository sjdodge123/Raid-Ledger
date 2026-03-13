/**
 * Tests for UserMenu header dropdown changes (ROK-548).
 * Verifies "View Profile" navigates to /users/{userId} and "My Settings" link exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserMenu } from './UserMenu';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
    isAdmin: (user: { role?: string } | null) => user?.role === 'admin',
    isOperatorOrAdmin: (user: { role?: string } | null) => user?.role === 'operator' || user?.role === 'admin',
    getAuthToken: () => 'test-token',
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: { discordConfigured: true } }),
}));

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../lib/avatar', () => ({
    resolveAvatar: () => ({ url: null }),
    toAvatarUser: (u: Record<string, unknown>) => u,
}));

vi.mock('../../hooks/use-focus-trap', () => ({
    useFocusTrap: () => ({ current: null }),
}));

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderUserMenu() {
    return render(
        <QueryClientProvider client={makeQueryClient()}>
            <MemoryRouter>
                <UserMenu />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('UserMenu dropdown (ROK-548)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({
            user: { id: 42, username: 'TestUser', role: 'member', discordId: null, avatar: null, customAvatarUrl: null },
            isAuthenticated: true,
            isImpersonating: false,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
            refetch: vi.fn(),
        });
    });

    it('shows "View Profile" text linking to /users/{userId} when dropdown is open', async () => {
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        const profileLink = screen.getByText('View Profile');
        expect(profileLink).toBeInTheDocument();
        const linkEl = profileLink.closest('a');
        expect(linkEl).toHaveAttribute('href', '/users/42');
    });

    it('shows "My Settings" link navigating to /profile when dropdown is open', async () => {
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        const settingsLink = screen.getByText('My Settings');
        expect(settingsLink).toBeInTheDocument();
        const linkEl = settingsLink.closest('a');
        expect(linkEl).toHaveAttribute('href', '/profile');
    });

    it('View Profile link uses the correct numeric userId, not a placeholder', async () => {
        // Different userId to ensure it's dynamic
        mockUseAuth.mockReturnValue({
            user: { id: 7, username: 'OtherUser', role: 'member', discordId: null, avatar: null, customAvatarUrl: null },
            isAuthenticated: true,
            isImpersonating: false,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
            refetch: vi.fn(),
        });
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /otheruser/i }));
        const linkEl = screen.getByText('View Profile').closest('a');
        expect(linkEl).toHaveAttribute('href', '/users/7');
    });

    it('dropdown is hidden before the avatar button is clicked', () => {
        renderUserMenu();
        expect(screen.queryByText('View Profile')).not.toBeInTheDocument();
        expect(screen.queryByText('My Settings')).not.toBeInTheDocument();
    });

    it('shows Logout button in dropdown', async () => {
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
    });

    it('does NOT show Admin Settings link for member role', async () => {
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        expect(screen.queryByText('Admin Settings')).not.toBeInTheDocument();
    });

    it('shows Admin Settings link for admin role', async () => {
        mockUseAuth.mockReturnValue({
            user: { id: 1, username: 'AdminUser', role: 'admin', discordId: null, avatar: null, customAvatarUrl: null },
            isAuthenticated: true,
            isImpersonating: false,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
            refetch: vi.fn(),
        });
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /adminuser/i }));
        expect(screen.getByText('Admin Settings')).toBeInTheDocument();
        const adminLink = screen.getByText('Admin Settings').closest('a');
        expect(adminLink).toHaveAttribute('href', '/admin/settings');
    });

    it('shows "Impersonating" status text when isImpersonating is true', async () => {
        mockUseAuth.mockReturnValue({
            user: { id: 42, username: 'TestUser', role: 'member', discordId: null, avatar: null, customAvatarUrl: null },
            isAuthenticated: true,
            isImpersonating: true,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
            refetch: vi.fn(),
        });
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        expect(screen.getByText('Impersonating')).toBeInTheDocument();
    });

    it('shows "Exit Impersonation" button when impersonating', async () => {
        mockUseAuth.mockReturnValue({
            user: { id: 42, username: 'TestUser', role: 'member', discordId: null, avatar: null, customAvatarUrl: null },
            isAuthenticated: true,
            isImpersonating: true,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
            refetch: vi.fn(),
        });
        const user = userEvent.setup();
        renderUserMenu();
        await user.click(screen.getByRole('button', { name: /testuser/i }));
        expect(screen.getByRole('button', { name: /exit impersonation/i })).toBeInTheDocument();
    });

    it('renders Discord login button when not authenticated and Discord is configured', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isAuthenticated: false,
            isImpersonating: false,
            logout: vi.fn(),
            impersonate: vi.fn(),
            exitImpersonation: vi.fn(),
        });
        renderUserMenu();
        expect(screen.getByRole('link', { name: /login with discord/i })).toBeInTheDocument();
    });

    it('username initial is shown as fallback when no avatar URL', async () => {
        const user = userEvent.setup();
        renderUserMenu();
        // The AvatarButton renders initials when no avatarUrl
        const button = screen.getByRole('button', { name: /testuser/i });
        // The initial 'T' should be present in the button
        expect(button.textContent).toContain('T');
    });
});
