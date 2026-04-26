/**
 * WelcomeStep tests (ROK-1116).
 *
 * The displayName input has been removed from the FTE welcome step. The step
 * now renders a static welcome message plus Continue/Skip buttons. Continue
 * advances to the next step without invoking any profile-update mutation, and
 * the displayName-availability hook is no longer referenced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WelcomeStep } from './welcome-step';

const updateProfileMutate = vi.fn();
const checkDisplayNameSpy = vi.fn(() => ({ data: undefined, isLoading: false }));

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
    useCheckDisplayName: (...args: unknown[]) => checkDisplayNameSpy(...args),
    useUpdateUserProfile: vi.fn(() => ({
        mutate: updateProfileMutate,
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
        </QueryClientProvider>,
    );
}

const mockOnNext = vi.fn();
const mockOnSkip = vi.fn();

describe('WelcomeStep (ROK-1116 — displayName input hidden)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT render a display name input', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />,
        );

        expect(screen.queryByLabelText(/display name/i)).toBeNull();
    });

    it('renders welcome heading "Welcome to Raid Ledger"', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />,
        );

        expect(
            screen.getByText(/welcome to raid ledger/i),
        ).toBeInTheDocument();
    });

    it('Continue button calls onNext when clicked and does NOT invoke the profile-update mutation', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />,
        );

        fireEvent.click(screen.getByRole('button', { name: /continue/i }));

        expect(mockOnNext).toHaveBeenCalledOnce();
        expect(updateProfileMutate).not.toHaveBeenCalled();
    });

    it('Skip button calls onSkip when clicked', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />,
        );

        fireEvent.click(screen.getByRole('button', { name: /skip/i }));

        expect(mockOnSkip).toHaveBeenCalledOnce();
    });

    it('does not invoke the displayName availability hook', () => {
        renderWithProviders(
            <WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />,
        );

        expect(checkDisplayNameSpy).not.toHaveBeenCalled();
    });
});
