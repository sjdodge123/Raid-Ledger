import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecureAccountStep } from './secure-account-step';

vi.mock('../../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({
        user: {
            id: 1,
            username: 'admin',
            discordId: 'local:admin',
        },
    })),
}));

vi.mock('../../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(() => ({
        changePassword: {
            mutate: vi.fn(),
            isPending: false,
        },
    })),
}));

vi.mock('../../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../../lib/toast', () => ({
    toast: {
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    },
}));

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('SecureAccountStep', () => {
    const mockOnNext = vi.fn();
    const mockOnSkip = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Rendering', () => {
        it('renders the Secure Your Account heading', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            expect(screen.getByText(/secure your account/i)).toBeInTheDocument();
        });

        it('renders password input fields', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            expect(screen.getByPlaceholderText(/enter current password/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/at least 8 characters/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/re-enter new password/i)).toBeInTheDocument();
        });

        it('renders the Next button', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
        });

        it('renders the "I\'ll do this later" skip button', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            expect(screen.getByRole('button', { name: /i'll do this later/i })).toBeInTheDocument();
        });
    });

    describe('Password inputs full-width at <768px (mobile)', () => {
        it('current password input has w-full class', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const currentInput = container.querySelector('input[placeholder="Enter current password"]');
            expect(currentInput).not.toBeNull();
            expect(currentInput!.className).toContain('w-full');
        });

        it('new password input has w-full class', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const newInput = container.querySelector('input[placeholder="At least 8 characters"]');
            expect(newInput).not.toBeNull();
            expect(newInput!.className).toContain('w-full');
        });

        it('confirm password input has w-full class', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const confirmInput = container.querySelector('input[placeholder="Re-enter new password"]');
            expect(confirmInput).not.toBeNull();
            expect(confirmInput!.className).toContain('w-full');
        });

        it('inputs have sm:max-w-md for desktop max-width constraint', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const currentInput = container.querySelector('input[placeholder="Enter current password"]');
            // On desktop, max-width is constrained; on mobile it's full-width
            expect(currentInput!.className).toContain('sm:max-w-md');
        });
    });

    describe('Touch target compliance (min-h-[44px])', () => {
        it('password inputs have min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const currentInput = container.querySelector('input[placeholder="Enter current password"]');
            expect(currentInput!.className).toContain('min-h-[44px]');
        });

        it('Change Password button has min-h-[44px]', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const changeBtn = screen.getByRole('button', { name: /change password/i });
            expect(changeBtn.className).toContain('min-h-[44px]');
        });

        it('Next button has min-h-[44px]', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const nextBtn = screen.getByRole('button', { name: /next/i });
            expect(nextBtn.className).toContain('min-h-[44px]');
        });

        it('skip button has min-h-[44px]', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const skipBtn = screen.getByRole('button', { name: /i'll do this later/i });
            expect(skipBtn.className).toContain('min-h-[44px]');
        });
    });

    describe('Password strength indicator', () => {
        it('shows strength indicator after entering a password', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const newInput = screen.getByPlaceholderText(/at least 8 characters/i);
            fireEvent.change(newInput, { target: { value: 'short' } });
            // Strength label should appear
            expect(screen.getByText(/weak|fair|good|strong/i)).toBeInTheDocument();
        });

        it('shows "Weak" for a short simple password', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const newInput = screen.getByPlaceholderText(/at least 8 characters/i);
            fireEvent.change(newInput, { target: { value: 'abc' } });
            expect(screen.getByText('Weak')).toBeInTheDocument();
        });

        it('shows "Strong" for a complex password', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const newInput = screen.getByPlaceholderText(/at least 8 characters/i);
            fireEvent.change(newInput, { target: { value: 'MyStr0ng!Pass' } });
            expect(screen.getByText('Strong')).toBeInTheDocument();
        });
    });

    describe('Password mismatch validation', () => {
        it('shows error when passwords do not match', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const newInput = screen.getByPlaceholderText(/at least 8 characters/i);
            const confirmInput = screen.getByPlaceholderText(/re-enter new password/i);

            fireEvent.change(newInput, { target: { value: 'Password123!' } });
            fireEvent.change(confirmInput, { target: { value: 'Mismatch123!' } });

            expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
        });
    });

    describe('Change Password button state', () => {
        it('Change Password button is disabled when fields are empty', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const btn = screen.getByRole('button', { name: /change password/i });
            expect(btn).toBeDisabled();
        });

        it('Next button calls onNext', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            expect(mockOnNext).toHaveBeenCalledOnce();
        });

        it('skip button calls onSkip callback', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fireEvent.click(screen.getByRole('button', { name: /i'll do this later/i }));
            expect(mockOnSkip).toHaveBeenCalledOnce();
        });
    });

    describe('Show passwords toggle', () => {
        it('toggles password visibility when "Show passwords" checkbox is checked', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const currentInput = container.querySelector('input[placeholder="Enter current password"]') as HTMLInputElement;
            expect(currentInput.type).toBe('password');

            const checkbox = screen.getByRole('checkbox');
            fireEvent.click(checkbox);

            expect(currentInput.type).toBe('text');
        });
    });
});
