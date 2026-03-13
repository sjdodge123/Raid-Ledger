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
});
