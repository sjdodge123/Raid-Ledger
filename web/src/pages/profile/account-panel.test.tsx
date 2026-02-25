/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for the AccountPanel (ROK-359).
 * Previously "Danger Zone" — verifies delete account flow and guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountPanel } from './account-panel';
import { renderWithProviders } from '../../test/render-helpers';
import * as useAuthHook from '../../hooks/use-auth';
import * as apiClient from '../../lib/api-client';

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../../lib/api-client', () => ({
    deleteMyAccount: vi.fn(),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(),
    isImpersonating: vi.fn(() => false),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

// Mock Modal to avoid portal issues in tests
vi.mock('../../components/ui/modal', () => ({
    Modal: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title: string }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="modal">
                <h2>{title}</h2>
                {children}
            </div>
        );
    },
}));

const mockUser = {
    id: 1,
    username: 'TestUser',
    displayName: null,
    role: 'member' as const,
};

describe('AccountPanel (ROK-359)', () => {
    const mockLogout = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: mockUser,
            isAuthenticated: true,
            logout: mockLogout,
        } as any);
        vi.mocked(useAuthHook.isImpersonating).mockReturnValue(false);
    });

    it('renders null when user is null', () => {
        vi.mocked(useAuthHook.useAuth).mockReturnValue({ user: null, isAuthenticated: false } as any);
        const { container } = renderWithProviders(<AccountPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('renders null when impersonating', () => {
        vi.mocked(useAuthHook.isImpersonating).mockReturnValue(true);
        const { container } = renderWithProviders(<AccountPanel />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the Danger Zone section heading', () => {
        renderWithProviders(<AccountPanel />);
        expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    });

    it('renders the Delete My Account button', () => {
        renderWithProviders(<AccountPanel />);
        expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
    });

    it('renders description text about irreversible actions', () => {
        renderWithProviders(<AccountPanel />);
        expect(screen.getByText(/irreversible actions/i)).toBeInTheDocument();
    });

    it('modal is not shown initially', () => {
        renderWithProviders(<AccountPanel />);
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('opens confirmation modal when Delete My Account is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('modal shows username in confirmation label', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        expect(screen.getByText('TestUser')).toBeInTheDocument();
    });

    it('confirmation input is empty initially', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        const input = screen.getByLabelText(/type.*to confirm/i);
        expect(input).toHaveValue('');
    });

    it('delete button in modal is disabled when confirmation name does not match', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        // Find the submit button inside modal (last "Delete My Account" button)
        const deleteButtons = screen.getAllByRole('button', { name: /delete my account/i });
        const modalDeleteBtn = deleteButtons[deleteButtons.length - 1];
        expect(modalDeleteBtn).toBeDisabled();
    });

    it('delete button in modal is enabled when confirmation name matches username', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        const input = screen.getByLabelText(/type.*to confirm/i);
        await user.type(input, 'TestUser');
        const deleteButtons = screen.getAllByRole('button', { name: /delete my account/i });
        const modalDeleteBtn = deleteButtons[deleteButtons.length - 1];
        expect(modalDeleteBtn).not.toBeDisabled();
    });

    it('closes modal when Cancel is clicked', async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        expect(screen.getByTestId('modal')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('uses displayName for confirmation when available', async () => {
        const user = userEvent.setup();
        vi.mocked(useAuthHook.useAuth).mockReturnValue({
            user: { ...mockUser, displayName: 'My Display Name' },
            isAuthenticated: true,
            logout: mockLogout,
        } as any);
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        expect(screen.getByText('My Display Name')).toBeInTheDocument();
    });

    it('enables delete button only when exact username is typed', async () => {
        const user = userEvent.setup();
        vi.mocked(apiClient.deleteMyAccount).mockResolvedValue(undefined as any);
        renderWithProviders(<AccountPanel />);
        await user.click(screen.getByRole('button', { name: /delete my account/i }));
        const input = screen.getByLabelText(/type.*to confirm/i);
        // Wrong name → disabled
        await user.type(input, 'WrongName');
        const deleteButtons = screen.getAllByRole('button', { name: /delete my account/i });
        const modalDeleteBtn = deleteButtons[deleteButtons.length - 1];
        expect(modalDeleteBtn).toBeDisabled();
        // Clear and type correct name → enabled
        await user.clear(input);
        await user.type(input, 'TestUser');
        expect(modalDeleteBtn).not.toBeDisabled();
    });
});
