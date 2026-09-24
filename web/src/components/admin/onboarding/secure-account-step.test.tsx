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

/** One stable changePassword mock, so a test can flip isPending and read mutate calls. */
const changePassword = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock('../../../hooks/use-onboarding', () => ({
    useOnboarding: vi.fn(() => ({ changePassword })),
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

const LABELS = ['Current Password', 'New Password', 'Confirm New Password'] as const;

function fillValidForm(confirm = 'Password123!') {
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'old-secret' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
}

describe('SecureAccountStep', () => {
    const mockOnNext = vi.fn();
    const mockOnSkip = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        changePassword.isPending = false;
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

        it('names every password field by its visible label (ROK-1645)', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            expect(screen.getByLabelText('Current Password')).toHaveAttribute('placeholder', 'Enter current password');
            expect(screen.getByLabelText('New Password')).toHaveAttribute('placeholder', 'At least 8 characters');
            expect(screen.getByLabelText('Confirm New Password')).toHaveAttribute('placeholder', 'Re-enter new password');
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

    function passwordInputsFullWidthAtGroup1() {
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

    }

    function passwordInputsFullWidthAtGroup2() {
it('confirm password input has w-full class', () => {
            const { container } = renderWithProviders(
                <SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />
            );
            const confirmInput = container.querySelector('input[placeholder="Re-enter new password"]');
            expect(confirmInput).not.toBeNull();
            expect(confirmInput!.className).toContain('w-full');
        });

it('each field sits in a sm:max-w-md wrapper that also holds its reveal toggle (ruling 15)', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            // On desktop, max-width is constrained; on mobile it's full-width. The
            // sized wrapper (not the <input>) carries it, so the eye toggle stays
            // inside the constrained frame instead of floating at the row's edge.
            for (const label of LABELS) {
                const wrapper = screen.getByLabelText(label).closest('.sm\\:max-w-md');
                const toggle = screen.queryByRole('button', { name: `Show ${label}` });
                expect(wrapper).not.toBeNull();
                expect(toggle, `reveal toggle for ${label}`).not.toBeNull();
                expect(wrapper).toContainElement(toggle);
            }
        });

    }

    describe('Password inputs full-width at <768px (mobile)', () => {
        passwordInputsFullWidthAtGroup1();
        passwordInputsFullWidthAtGroup2();
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

        it('a mismatched confirm is aria-invalid and described by the inline error (AC1)', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fillValidForm('Mismatch123!');
            const confirmInput = screen.getByLabelText('Confirm New Password');
            expect(confirmInput).toHaveAttribute('aria-invalid', 'true');
            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent('Passwords do not match');
            expect(alert.id).not.toBe('');
            expect(confirmInput.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
        });

        it('a matching confirm clears aria-invalid and the error', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fillValidForm('Mismatch123!');
            fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Password123!' } });
            const confirmInput = screen.getByLabelText('Confirm New Password');
            expect(confirmInput).not.toHaveAttribute('aria-invalid');
            expect(confirmInput).not.toHaveAttribute('aria-describedby');
            expect(screen.queryByText(/passwords do not match/i)).toBeNull();
        });

        it('an empty confirm is not flagged', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Password123!' } });
            expect(screen.getByLabelText('Confirm New Password')).not.toHaveAttribute('aria-invalid');
            expect(screen.queryByRole('alert')).toBeNull();
        });
    });

    describe('Change Password button state', () => {
        it('Change Password button is disabled when fields are empty', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const btn = screen.getByRole('button', { name: /change password/i });
            expect(btn).toBeDisabled();
        });

        it('a valid form submits current + new password', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fillValidForm();
            fireEvent.click(screen.getByRole('button', { name: /change password/i }));
            expect(changePassword.mutate).toHaveBeenCalledOnce();
            expect(changePassword.mutate.mock.calls[0][0]).toEqual({ currentPassword: 'old-secret', newPassword: 'Password123!' });
        });

        it('while pending the button is busy, named "Changing...", and swallows clicks (ruling 7)', () => {
            changePassword.isPending = true;
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            fillValidForm();
            const btn = screen.getByRole('button', { name: 'Changing...' });
            expect(btn).toHaveAttribute('aria-busy', 'true');
            expect(btn).toHaveAttribute('aria-disabled', 'true');
            fireEvent.click(btn);
            expect(changePassword.mutate).not.toHaveBeenCalled();
        });

        it('Link Discord Account is a Button with the Discord brand fill (ruling 3)', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const link = screen.getByRole('button', { name: /link discord account/i });
            expect(link).toHaveAttribute('data-brand-fill');
            expect(link).toHaveStyle({ backgroundColor: '#5865F2' });
            expect(link.className).toContain('min-h-[44px]');
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

        it('"Show passwords" reveals and re-hides all three fields', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const checkbox = screen.getByRole('checkbox', { name: 'Show passwords' });
            fireEvent.click(checkbox);
            for (const label of LABELS) expect(screen.getByLabelText(label)).toHaveAttribute('type', 'text');
            fireEvent.click(checkbox);
            for (const label of LABELS) expect(screen.getByLabelText(label)).toHaveAttribute('type', 'password');
        });

        it('a field\'s own eye toggle drives the shared reveal and the checkbox', () => {
            renderWithProviders(<SecureAccountStep onNext={mockOnNext} onSkip={mockOnSkip} />);
            const eye = screen.queryByRole('button', { name: 'Show New Password' });
            expect(eye, 'New Password reveal toggle').not.toBeNull();
            fireEvent.click(eye!);
            for (const label of LABELS) expect(screen.getByLabelText(label)).toHaveAttribute('type', 'text');
            expect(screen.getByRole('checkbox', { name: 'Show passwords' })).toBeChecked();
        });
    });
});
