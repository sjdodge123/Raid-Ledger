/**
 * Tests for AccountPanel (ROK-548).
 * Verifies the account panel renders Danger Zone content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountPanel } from './account-panel';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 1, username: 'TestUser', displayName: 'TestUser' },
        isAuthenticated: true,
        logout: vi.fn(),
    })),
    isImpersonating: vi.fn(() => false),
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

import { useAuth, isImpersonating } from '../../hooks/use-auth';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockIsImpersonating = isImpersonating as ReturnType<typeof vi.fn>;

describe('AccountPanel (ROK-548)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({
            user: { id: 1, username: 'TestUser', displayName: 'TestUser' },
            isAuthenticated: true,
            logout: vi.fn(),
        });
        mockIsImpersonating.mockReturnValue(false);
    });

    it('renders Danger Zone heading', () => {
        renderAccountPanel();
        expect(screen.getByRole('heading', { name: /danger zone/i })).toBeInTheDocument();
    });

    it('renders Delete My Account button', () => {
        renderAccountPanel();
        expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
    });

    it('renders the danger zone description text', () => {
        renderAccountPanel();
        expect(screen.getByText(/irreversible actions/i)).toBeInTheDocument();
    });

    it('opens confirmation modal when Delete My Account button is clicked', async () => {
        const user = userEvent.setup();
        renderAccountPanel();
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        // Modal should show confirmation input
        expect(screen.getByLabelText(/type.*to confirm/i)).toBeInTheDocument();
    });

    it('confirm button is disabled when confirm input does not match username', async () => {
        const user = userEvent.setup();
        renderAccountPanel();
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        // The confirm button should be disabled since no text entered
        const allDeleteBtns = screen.getAllByRole('button', { name: /delete my account/i });
        const modalConfirmBtn = allDeleteBtns[allDeleteBtns.length - 1];
        expect(modalConfirmBtn).toBeDisabled();
    });

    it('confirm button is enabled when input matches displayName', async () => {
        const user = userEvent.setup();
        renderAccountPanel();
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        const input = screen.getByLabelText(/type.*to confirm/i);
        await user.type(input, 'TestUser');
        const allDeleteBtns = screen.getAllByRole('button', { name: /delete my account/i });
        const modalConfirmBtn = allDeleteBtns[allDeleteBtns.length - 1];
        expect(modalConfirmBtn).not.toBeDisabled();
    });

    it('returns null when user is impersonating', () => {
        mockIsImpersonating.mockReturnValue(true);
        const { container } = renderAccountPanel();
        expect(container.firstChild).toBeNull();
    });

    it('returns null when user is not logged in', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isAuthenticated: false,
            logout: vi.fn(),
        });
        const { container } = renderAccountPanel();
        expect(container.firstChild).toBeNull();
    });
});
