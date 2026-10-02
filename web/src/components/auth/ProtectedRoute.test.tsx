import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedRoute } from './ProtectedRoute';
import {
    saveAuthRedirect,
    consumeAuthRedirect,
    AUTH_REDIRECT_TTL_MS,
} from '../../lib/auth-redirect';

// Mock useAuth hook
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
}));

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderWithRouter(
    ui: React.ReactElement,
    { route = '/protected' } = {}
) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            <MemoryRouter initialEntries={[route]}>
                <Routes>
                    <Route path="/" element={<div>Login Page</div>} />
                    <Route path="/login" element={<div>Login Page</div>} />
                    <Route path="/protected" element={ui} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

function protectedrouteGroup1() {
it('shows loading spinner while checking auth', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: true,
        });

        renderWithRouter(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>
        );

        expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
    });

}

function protectedrouteGroup2() {
it('redirects to login when not authenticated', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: false,
        });

        renderWithRouter(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>
        );

        expect(screen.getByText('Login Page')).toBeInTheDocument();
    });

}

function protectedrouteGroup3() {
it('renders children when authenticated', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: true,
            isLoading: false,
        });

        renderWithRouter(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>
        );

        expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

}

function protectedrouteGroup4() {
it('saves current path before redirecting to login', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: false,
        });

        renderWithRouter(
            <ProtectedRoute>
                <div>Protected Content</div>
            </ProtectedRoute>,
            { route: '/protected?query=test' }
        );

        expect(sessionStorage.getItem('authRedirect')).toBe('/protected?query=test');
    });

}

describe('ProtectedRoute', () => {
beforeEach(() => {
        sessionStorage.clear();
        mockUseAuth.mockReset();
    });

afterEach(() => {
        sessionStorage.clear();
    });

    protectedrouteGroup1();
    protectedrouteGroup2();
    protectedrouteGroup3();
    protectedrouteGroup4();
});

describe('saveAuthRedirect / consumeAuthRedirect', () => {
    const SAVED_AT = new Date('2026-10-02T12:00:00Z').getTime();

    beforeEach(() => {
        sessionStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        sessionStorage.clear();
    });

    it('saves and retrieves redirect path', () => {
        saveAuthRedirect('/some/path');
        expect(consumeAuthRedirect()).toBe('/some/path');
    });

    it('clears redirect after consuming', () => {
        saveAuthRedirect('/some/path');
        consumeAuthRedirect();
        expect(consumeAuthRedirect()).toBeNull();
    });

    it('returns null when no redirect saved', () => {
        expect(consumeAuthRedirect()).toBeNull();
    });

    it('drops a redirect saved longer ago than the TTL and clears both keys', () => {
        vi.setSystemTime(SAVED_AT);
        saveAuthRedirect('/events/1');
        vi.setSystemTime(SAVED_AT + AUTH_REDIRECT_TTL_MS + 1);
        expect(consumeAuthRedirect()).toBeNull();
        const path: string | null = sessionStorage.getItem('authRedirect');
        const savedAt: string | null = sessionStorage.getItem('authRedirectSavedAt');
        expect(path).toBeNull();
        expect(savedAt).toBeNull();
    });

    it('returns a redirect saved just inside the TTL', () => {
        vi.setSystemTime(SAVED_AT);
        saveAuthRedirect('/events/1');
        vi.setSystemTime(SAVED_AT + AUTH_REDIRECT_TTL_MS - 1000);
        expect(consumeAuthRedirect()).toBe('/events/1');
    });

    it('treats a raw entry with no saved-at timestamp as expired and removes it', () => {
        vi.setSystemTime(SAVED_AT);
        sessionStorage.setItem('authRedirect', '/events/1');
        expect(consumeAuthRedirect()).toBeNull();
        const path: string | null = sessionStorage.getItem('authRedirect');
        expect(path).toBeNull();
    });
});
