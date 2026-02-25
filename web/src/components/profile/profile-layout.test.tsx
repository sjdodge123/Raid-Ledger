/**
 * Tests for ProfileLayout routing behaviour (ROK-359).
 * AC6: Panels render inline via Outlet (no sub-navigation).
 * AC7: Old profile sub-paths redirect to consolidated paths.
 * AC8: Sidebar is hidden on mobile (hidden md:block wrapper).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileLayout } from './profile-layout';
import { Navigate } from 'react-router-dom';

// Mock CSS import to prevent style resolution errors in test environment
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

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** A helper component that renders the current pathname so tests can assert on it. */
function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="location-display">{location.pathname}</div>;
}

/**
 * Render a minimal route tree that mirrors the App.tsx /profile routes.
 * The `initialPath` is where the browser starts; assertions check where it ends up.
 */
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
                        <Route path="identity" element={<div data-testid="identity-panel">Identity Content</div>} />
                        <Route path="preferences" element={<div data-testid="preferences-panel">Preferences Content</div>} />
                        <Route path="gaming" element={<div data-testid="gaming-panel">Gaming Content</div>} />
                        <Route path="account" element={<div data-testid="account-panel">Account Content</div>} />
                        <Route path="notifications" element={<div data-testid="notifications-panel">Notifications Content</div>} />

                        {/* ROK-359: Redirects for old bookmarked profile paths */}
                        <Route path="identity/discord" element={<Navigate to="/profile/identity" replace />} />
                        <Route path="identity/avatar" element={<Navigate to="/profile/identity" replace />} />
                        <Route path="preferences/appearance" element={<Navigate to="/profile/preferences" replace />} />
                        <Route path="preferences/timezone" element={<Navigate to="/profile/preferences" replace />} />
                        <Route path="preferences/notifications" element={<Navigate to="/profile/notifications" replace />} />
                        <Route path="gaming/game-time" element={<Navigate to="/profile/gaming" replace />} />
                        <Route path="gaming/characters" element={<Navigate to="/profile/gaming" replace />} />
                        <Route path="gaming/watched-games" element={<Navigate to="/profile/gaming" replace />} />
                        <Route path="danger/delete-account" element={<Navigate to="/profile/account" replace />} />
                    </Route>
                    <Route path="*" element={<LocationDisplay />} />
                </Routes>
                <LocationDisplay />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

// ─── AC7: Route Redirects ────────────────────────────────────────────────────

describe('AC7: old profile paths redirect to consolidated paths (ROK-359)', () => {
    it('redirects /profile/identity/discord to /profile/identity', () => {
        renderProfileRoutes('/profile/identity/discord');
        expect(screen.getByTestId('identity-panel')).toBeInTheDocument();
    });

    it('redirects /profile/identity/avatar to /profile/identity', () => {
        renderProfileRoutes('/profile/identity/avatar');
        expect(screen.getByTestId('identity-panel')).toBeInTheDocument();
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

    it('redirects /profile/gaming/game-time to /profile/gaming', () => {
        renderProfileRoutes('/profile/gaming/game-time');
        expect(screen.getByTestId('gaming-panel')).toBeInTheDocument();
    });

    it('redirects /profile/gaming/characters to /profile/gaming', () => {
        renderProfileRoutes('/profile/gaming/characters');
        expect(screen.getByTestId('gaming-panel')).toBeInTheDocument();
    });

    it('redirects /profile/gaming/watched-games to /profile/gaming', () => {
        renderProfileRoutes('/profile/gaming/watched-games');
        expect(screen.getByTestId('gaming-panel')).toBeInTheDocument();
    });

    it('redirects /profile/danger/delete-account to /profile/account', () => {
        renderProfileRoutes('/profile/danger/delete-account');
        expect(screen.getByTestId('account-panel')).toBeInTheDocument();
    });
});

// ─── AC6: Panels render inline via Outlet ───────────────────────────────────

describe('AC6: profile panels render inline via Outlet, no sub-navigation (ROK-359)', () => {
    it('navigating to /profile/gaming renders GamingPanel content inline in the layout', () => {
        renderProfileRoutes('/profile/gaming');
        expect(screen.getByTestId('gaming-panel')).toBeInTheDocument();
    });

    it('navigating to /profile/preferences renders PreferencesPanel content inline in the layout', () => {
        renderProfileRoutes('/profile/preferences');
        expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    });

    it('navigating to /profile/account renders AccountPanel content inline in the layout', () => {
        renderProfileRoutes('/profile/account');
        expect(screen.getByTestId('account-panel')).toBeInTheDocument();
    });
});

// ─── AC8: Mobile sidebar collapse ────────────────────────────────────────────

describe('AC8: sidebar is hidden on mobile via layout wrapper (ROK-359)', () => {
    it('renders the sidebar inside a wrapper that has the mobile-hide class', () => {
        mockUseAuth.mockReturnValue({
            user: { id: 1, username: 'TestUser', role: 'member' },
            isAuthenticated: true,
            isLoading: false,
            refetch: vi.fn(),
        });

        const { container } = render(
            <QueryClientProvider client={makeQueryClient()}>
                <MemoryRouter initialEntries={['/profile/identity']}>
                    <Routes>
                        <Route path="/profile" element={<ProfileLayout />}>
                            <Route path="identity" element={<div>Identity</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );

        // The aside element wraps the ProfileSidebar and uses hidden md:block to
        // hide it on mobile viewports. This is the layout contract for AC8.
        const aside = container.querySelector('aside');
        expect(aside).not.toBeNull();
        expect(aside!.className).toContain('hidden');
        expect(aside!.className).toContain('md:block');
    });
});
