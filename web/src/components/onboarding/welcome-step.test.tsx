/**
 * WelcomeStep tests (ROK-1116).
 *
 * The displayName input has been removed from the FTE welcome step. The step
 * now renders a static welcome message plus Continue/Skip buttons. Continue
 * advances to the next step without invoking any profile-update mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeStep } from './welcome-step';

const mockOnNext = vi.fn();
const mockOnSkip = vi.fn();

describe('WelcomeStep (ROK-1116 — displayName input hidden)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT render a display name input', () => {
        render(<WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />);

        expect(screen.queryByLabelText(/display name/i)).toBeNull();
    });

    it('renders welcome heading "Welcome to Raid Ledger"', () => {
        render(<WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />);

        expect(
            screen.getByText(/welcome to raid ledger/i),
        ).toBeInTheDocument();
    });

    it('Continue button calls onNext when clicked', () => {
        render(<WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />);

        fireEvent.click(screen.getByRole('button', { name: /continue/i }));

        expect(mockOnNext).toHaveBeenCalledOnce();
    });

    it('Skip button calls onSkip when clicked', () => {
        render(<WelcomeStep onNext={mockOnNext} onSkip={mockOnSkip} />);

        fireEvent.click(screen.getByRole('button', { name: /skip/i }));

        expect(mockOnSkip).toHaveBeenCalledOnce();
    });
});
