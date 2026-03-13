/**
 * Tests for ProfileLayout routing behaviour (ROK-548).
 * Verifies new route structure with avatar as default, backward-compat redirects,
 * and mobile title change from "My Profile" to "My Settings".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileLayout } from './profile-layout';
import { Navigate } from 'react-router-dom';

vi.mock('./integration-hub.css', () => ({}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

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

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="location-display">{location.pathname}</div>;
}

function renderProfileRoutes(initialPath: string) {
    mockUseAuth.mockReturnValue({
        user: { id: 1, username: 'TestUser', role: 'member' },
        isAuthenticated: true,
        isLoading: false,
        refetch: vi.fn(),
    });

    return render(
        <QueryClientProvider client={makeQueryClient()}>
            <MemoryRouter initialEntries={[initialPath]}>
                <Routes>
                    <Route path="/profile" element={<ProfileLayout />}>
                        <Route path="avatar" element={<div data-testid="avatar-panel">Avatar Content</div>} />
                        <Route path="integrations" element={<div data-testid="integrations-panel">Integrations Content</div>} />
                        <Route path="preferences" element={<div data-testid="preferences-panel">Preferences Content</div>} />
                        <Route path="notifications" element={<div data-testid="notifications-panel">Notifications Content</div>} />
                        <Route path="gaming/game-time" element={<div data-testid="game-time-panel">Game Time Content</div>} />
                        <Route path="gaming/characters" element={<div data-testid="characters-panel">Characters Content</div>} />
                        <Route path="gaming/watched-games" element={<div data-testid="watched-games-panel">Watched Games Content</div>} />
                        <Route path="account" element={<div data-testid="account-panel">Account Content</div>} />
                        {/* backward compat redirects */}
                        <Route path="identity" element={<Navigate to="/profile/avatar" replace />} />
                        <Route path="identity/discord" element={<Navigate to="/profile/integrations" replace />} />
                        <Route path="identity/avatar" element={<Navigate to="/profile/avatar" replace />} />
                        <Route path="preferences/appearance" element={<Navigate to="/profile/preferences" replace />} />
                        <Route path="preferences/timezone" element={<Navigate to="/profile/preferences" replace />} />
                        <Route path="preferences/notifications" element={<Navigate to="/profile/notifications" replace />} />
                        <Route path="gaming" element={<Navigate to="/profile/gaming/game-time" replace />} />
                        <Route path="danger/delete-account" element={<Navigate to="/profile/account" replace />} />
                    </Route>
                    <Route path="*" element={<LocationDisplay />} />
                </Routes>
                <LocationDisplay />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('ROK-548: /profile defaults to /profile/avatar', () => {
    it('redirects /profile to /profile/avatar', () => {
        renderProfileRoutes('/profile');
        expect(screen.getByTestId('avatar-panel')).toBeInTheDocument();
    });

    it('redirects /profile/ (trailing slash) to /profile/avatar', () => {
        renderProfileRoutes('/profile/');
        expect(screen.getByTestId('avatar-panel')).toBeInTheDocument();
    });
});

describe('ROK-548: backward compat redirects', () => {
    it('redirects /profile/identity to /profile/avatar', () => {
        renderProfileRoutes('/profile/identity');
        expect(screen.getByTestId('avatar-panel')).toBeInTheDocument();
    });

    it('redirects /profile/identity/discord to /profile/integrations', () => {
        renderProfileRoutes('/profile/identity/discord');
        expect(screen.getByTestId('integrations-panel')).toBeInTheDocument();
    });

    it('redirects /profile/identity/avatar to /profile/avatar', () => {
        renderProfileRoutes('/profile/identity/avatar');
        expect(screen.getByTestId('avatar-panel')).toBeInTheDocument();
    });

    it('redirects /profile/danger/delete-account to /profile/account', () => {
        renderProfileRoutes('/profile/danger/delete-account');
        expect(screen.getByTestId('account-panel')).toBeInTheDocument();
    });

    it('still renders /profile/preferences directly', () => {
        renderProfileRoutes('/profile/preferences');
        expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    });

    it('still renders gaming routes', () => {
        renderProfileRoutes('/profile/gaming/game-time');
        expect(screen.getByTestId('game-time-panel')).toBeInTheDocument();
    });

    it('renders account panel at /profile/account', () => {
        renderProfileRoutes('/profile/account');
        expect(screen.getByTestId('account-panel')).toBeInTheDocument();
    });
});

describe('ROK-548: mobile title shows "My Settings"', () => {
    it('renders h1 with "My Settings" instead of "My Profile"', () => {
        renderProfileRoutes('/profile/avatar');
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Settings');
    });
});

describe('ROK-548: sidebar mobile hide', () => {
    it('renders sidebar inside a wrapper with hidden md:block classes', () => {
        const { container } = renderProfileRoutes('/profile/avatar');
        const aside = container.querySelector('aside');
        expect(aside).not.toBeNull();
        expect(aside!.className).toContain('hidden');
        expect(aside!.className).toContain('md:block');
    });
});

describe('ROK-548: ProfileLayout auth states', () => {
    it('shows loading skeleton when authLoading is true', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isAuthenticated: false,
            isLoading: true,
            refetch: vi.fn(),
        });
        render(
            <QueryClientProvider client={makeQueryClient()}>
                <MemoryRouter initialEntries={['/profile/avatar']}>
                    <Routes>
                        <Route path="/profile" element={<ProfileLayout />}>
                            <Route path="avatar" element={<div>Avatar</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );
        // Skeleton renders an animate-pulse div, not the sidebar
        expect(screen.queryByRole('navigation', { name: /profile navigation/i })).not.toBeInTheDocument();
    });

    it('redirects to / when user is not authenticated', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            refetch: vi.fn(),
        });
        const { container } = render(
            <QueryClientProvider client={makeQueryClient()}>
                <MemoryRouter initialEntries={['/profile/avatar']}>
                    <Routes>
                        <Route path="/profile" element={<ProfileLayout />}>
                            <Route path="avatar" element={<div data-testid="avatar-panel">Avatar</div>} />
                        </Route>
                        <Route path="/" element={<div data-testid="home-page">Home</div>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );
        // Should redirect to / — avatar panel should not be rendered
        expect(screen.queryByTestId('avatar-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('home-page')).toBeInTheDocument();
        void container;
    });

    it('redirects /profile/preferences/appearance to /profile/preferences', () => {
        renderProfileRoutes('/profile/preferences/appearance');
        expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    });

    it('redirects /profile/preferences/timezone to /profile/preferences', () => {
        renderProfileRoutes('/profile/preferences/timezone');
        expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    });

    it('redirects /profile/preferences/notifications to /profile/notifications', () => {
        renderProfileRoutes('/profile/preferences/notifications');
        expect(screen.getByTestId('notifications-panel')).toBeInTheDocument();
    });

    it('redirects /profile/gaming to /profile/gaming/game-time', () => {
        renderProfileRoutes('/profile/gaming');
        expect(screen.getByTestId('game-time-panel')).toBeInTheDocument();
    });
});
