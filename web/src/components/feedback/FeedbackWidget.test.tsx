/**
 * ROK-1651 AC3 (FAB half, ruling 15) — the floating feedback trigger is the
 * shared `Button iconOnly` inside a positioned wrapper div. The wrapper owns
 * `hidden md:block fixed …`, so nothing fights the Button's own `inline-flex`
 * or `rounded-lg` (no tailwind-merge). The mobile path (MoreDrawer →
 * onRegisterOpen) is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from '../../hooks/use-auth';
import { FeedbackWidget } from './FeedbackWidget';

vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/use-feedback', () => ({
    useSubmitFeedback: () => ({ mutate: vi.fn(), reset: vi.fn(), error: null, isError: false }),
}));
vi.mock('../../sentry', () => ({ captureMessageVerified: vi.fn() }));

beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as ReturnType<typeof useAuth>);
});

describe('FeedbackWidget — floating trigger', () => {
    it('is a "Send Feedback" button inside a fixed, md-only wrapper; the button carries no display class', () => {
        render(<FeedbackWidget />);
        const button = screen.getByRole('button', { name: 'Send Feedback' });
        const wrapper = button.parentElement as HTMLElement;
        expect(wrapper.className.split(' ')).toEqual(
            expect.arrayContaining(['hidden', 'md:block', 'fixed', 'bottom-6', 'right-6', 'z-40']),
        );
        const buttonClasses = button.className.split(' ');
        expect(buttonClasses).not.toContain('hidden');
        expect(buttonClasses).not.toContain('md:flex');
        expect(buttonClasses).toContain('min-w-[44px]');
    });

    it('opens the "Send Feedback" dialog when clicked', async () => {
        render(<FeedbackWidget />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Send Feedback' }));
        expect(screen.queryAllByRole('dialog', { name: 'Send Feedback' })).toHaveLength(1);
    });
});

describe('FeedbackWidget — mobile open path', () => {
    it('hands onRegisterOpen a function that opens the dialog', () => {
        const onRegisterOpen = vi.fn();
        render(<FeedbackWidget onRegisterOpen={onRegisterOpen} />);
        expect(onRegisterOpen).toHaveBeenCalledWith(expect.any(Function));
        const openFn = onRegisterOpen.mock.calls.at(-1)?.[0] as () => void;
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => openFn());
        expect(screen.queryAllByRole('dialog', { name: 'Send Feedback' })).toHaveLength(1);
    });
});
