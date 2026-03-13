/**
 * Tests for AccountPanel (ROK-548).
 * Verifies the account panel renders Danger Zone content.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountPanel } from './account-panel';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', displayName: 'TestUser' },
        isAuthenticated: true,
        logout: vi.fn(),
    }),
    isImpersonating: () => false,
}));

vi.mock('../../lib/api-client', () => ({
    deleteMyAccount: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderAccountPanel() {
    return render(
        <QueryClientProvider client={makeQueryClient()}>
            <MemoryRouter>
                <AccountPanel />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('AccountPanel (ROK-548)', () => {
    it('renders Danger Zone heading', () => {
        renderAccountPanel();
        expect(screen.getByRole('heading', { name: /danger zone/i })).toBeInTheDocument();
    });

    it('renders Delete My Account button', () => {
        renderAccountPanel();
        expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
    });
});
