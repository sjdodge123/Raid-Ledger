/**
 * ROK-1651 AC3 — FeedbackDialog on the shared form primitives: Modal (focus
 * trap, Escape, role=dialog), RadioGroup segmented for the category (no
 * emoji), Field + Textarea with its counter, Checkbox for the logs opt-in,
 * a loading Button, and an inline role=alert error (operator ruling).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackDialog } from './FeedbackDialog';

type Props = Parameters<typeof FeedbackDialog>[0];

function renderDialog(overrides: Partial<Props> = {}) {
    const props: Props = {
        showSuccess: false, category: 'bug', message: '', includeClientLogs: false,
        isSubmitting: false, sentryError: false, submitError: null, isError: false,
        onCategoryChange: vi.fn(), onMessageChange: vi.fn(), onIncludeLogsChange: vi.fn(),
        onSubmit: vi.fn(), onClose: vi.fn(), ...overrides,
    };
    render(<FeedbackDialog {...props} />);
    return props;
}

describe('FeedbackDialog — Modal shell', () => {
    it('is a dialog named "Send Feedback" and Escape closes it', () => {
        const props = renderDialog();
        expect(screen.getByRole('dialog', { name: 'Send Feedback' })).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});

describe('FeedbackDialog — category', () => {
    it('is a "Category" radiogroup of 4 emoji-free radios; picking Feature reports it', async () => {
        const props = renderDialog();
        const group = screen.getByRole('radiogroup', { name: 'Category' });
        const names = within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent);
        expect(names).toEqual(['Bug', 'Feature', 'Improvement', 'Other']);
        expect(within(group).getByRole('radio', { name: 'Bug' })).toBeChecked();
        await userEvent.click(within(group).getByRole('radio', { name: 'Feature' }));
        expect(props.onCategoryChange).toHaveBeenCalledWith('feature');
    });
});

describe('FeedbackDialog — message', () => {
    it('shows the Textarea counter and the min-length hint, and disables Send under 10 characters', () => {
        renderDialog({ message: '' });
        const box = screen.getByRole('textbox', { name: 'Message' });
        expect(box).toHaveAttribute('maxlength', '2000');
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('0/2000');
        expect(screen.getByText('10 more characters needed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send Feedback' })).toBeDisabled();
    });

    it('drops the hint and enables Send once the message reaches 10 characters', () => {
        renderDialog({ message: '0123456789' });
        expect(screen.queryByText(/more characters needed/)).not.toBeInTheDocument();
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('10/2000');
        expect(screen.getByRole('button', { name: 'Send Feedback' })).toBeEnabled();
    });
});

describe('FeedbackDialog — client logs opt-in', () => {
    it('offers the logs checkbox for a bug', () => {
        renderDialog({ category: 'bug' });
        expect(screen.getByRole('checkbox', { name: 'Capture and send client logs' })).not.toBeChecked();
    });

    it('hides the logs checkbox for a feature request', () => {
        renderDialog({ category: 'feature' });
        expect(screen.queryByRole('checkbox', { name: 'Capture and send client logs' })).not.toBeInTheDocument();
    });
});

describe('FeedbackDialog — errors and submit', () => {
    it('renders a submit failure inline as role=alert in text-danger', () => {
        renderDialog({ isError: true, submitError: new Error('Rate limited') });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Rate limited');
        expect(alert).toHaveClass('text-danger');
        expect(alert).not.toHaveAttribute('style');
    });

    it('a pending submit is aria-busy + aria-disabled and swallows the click', async () => {
        const props = renderDialog({ message: 'long enough message', isSubmitting: true });
        const button = screen.getByRole('button', { name: 'Sending…' });
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(button).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(button);
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('a ready submit sends', async () => {
        const props = renderDialog({ message: 'long enough message' });
        await userEvent.click(screen.getByRole('button', { name: 'Send Feedback' }));
        expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });

    it('the success state thanks the user and has no submit footer', () => {
        renderDialog({ showSuccess: true });
        expect(screen.getByText('Thanks for your feedback!')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send Feedback' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('modal-footer')).not.toBeInTheDocument();
    });
});
