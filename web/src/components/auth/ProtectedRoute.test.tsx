import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedRoute } from './ProtectedRoute';
import { saveAuthRedirect, consumeAuthRedirect } from '../../lib/auth-redirect';

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

describe('ProtectedRoute', () => {
    beforeEach(() => {
        sessionStorage.clear();
        mockUseAuth.mockReset();
    });

    afterEach(() => {
        sessionStorage.clear();
    });

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
});

describe('saveAuthRedirect / consumeAuthRedirect', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
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
});
