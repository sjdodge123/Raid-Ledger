import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WelcomeStep } from './welcome-step';

// Mock the hooks
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({
        user: {
            id: 1,
            username: 'testuser',
            displayName: null,
            role: 'member',
            onboardingCompletedAt: null,
        },
    })),
}));

vi.mock('../../hooks/use-onboarding-fte', () => ({
    useCheckDisplayName: vi.fn((name: string) => ({
        data: name === 'TakenName' ? { available: false } : { available: true },
        isLoading: false,
    })),
    useUpdateUserProfile: vi.fn(() => ({
        mutate: vi.fn((displayName, options) => {
            options?.onSuccess?.();
        }),
        isPending: false,
    })),
}));

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('WelcomeStep', () => {
    const mockOnNext = vi.fn();
    const mockOnSkip = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders welcome message and display name input', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        expect(screen.getByText(/welcome to raid ledger!/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    });

    it('pre-fills display name from user username', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i) as HTMLInputElement;
        expect(input.value).toBe('testuser');
    });

    it('validates display name length (min 2 chars)', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'a' } });

        expect(screen.getByText(/1\/30 characters \(min 2\)/i)).toBeInTheDocument();
    });

    it('validates display name length (max 30 chars)', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'a'.repeat(30) } });

        expect(screen.getByText(/30\/30 characters/i)).toBeInTheDocument();
    });

    it('shows availability indicator when name is available', async () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'AvailableName' } });

        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });
    });

    it('shows taken indicator when name is unavailable', async () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'TakenName' } });

        await waitFor(() => {
            expect(screen.getByText(/taken/i)).toBeInTheDocument();
        });
    });

    it('calls onSkip when Skip button is clicked', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        fireEvent.click(screen.getByRole('button', { name: /skip/i }));

        expect(mockOnSkip).toHaveBeenCalledOnce();
    });

    it('calls onNext after successful update', async () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'ValidName' } });

        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => {
            expect(mockOnNext).toHaveBeenCalledOnce();
        });
    });

    it('supports Enter key to submit', async () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'ValidName' } });

        await waitFor(() => {
            expect(screen.getByText(/available/i)).toBeInTheDocument();
        });

        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(mockOnNext).toHaveBeenCalledOnce();
        });
    });

    it('disables Next button when name is too short', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'a' } });

        const nextButton = screen.getByRole('button', { name: /next/i });
        expect(nextButton).toBeDisabled();
    });

    it('disables Next button when name is taken', async () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />
        );

        const input = screen.getByLabelText(/display name/i);
        fireEvent.change(input, { target: { value: 'TakenName' } });

        await waitFor(() => {
            const nextButton = screen.getByRole('button', { name: /next/i });
            expect(nextButton).toBeDisabled();
        });
    });
});
