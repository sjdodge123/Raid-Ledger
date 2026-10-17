/**
 * cancel-event-modal.test.tsx
 *
 * CancelEventModal: initialReason (ROK-536), the shared-primitive restyle
 * (ROK-1649) and the dirty-close guard + pinned footer (ROK-1655 AC1-AC3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancelEventModal } from '../cancel-event-modal';

const m = vi.hoisted(() => ({
    cancel: { mutateAsync: vi.fn(), isPending: false },
    poll: { mutateAsync: vi.fn(), isPending: false },
}));

// Mock the hooks used by CancelEventModal
vi.mock('../../../hooks/use-events', () => ({
    useCancelEvent: () => m.cancel,
}));
vi.mock('../../../hooks/use-standalone-poll', () => ({
    useCreateSchedulingPoll: () => m.poll,
}));

beforeEach(() => {
    m.cancel.mutateAsync = vi.fn().mockResolvedValue(undefined);
    m.cancel.isPending = false;
    m.poll.mutateAsync = vi.fn().mockResolvedValue({ id: 9, lineupId: 4 });
    m.poll.isPending = false;
});

function renderModal(props: Partial<React.ComponentProps<typeof CancelEventModal>> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = props.onClose ?? vi.fn();
    const view = render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                <CancelEventModal
                    isOpen={true}
                    eventId={1}
                    eventTitle="Test Event"
                    signupCount={5}
                    {...props}
                    onClose={onClose}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return { ...view, onClose };
}

const reasonBox = () => screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(reasonBox(), { target: { value } });
const discardHeading = () => screen.queryByRole('heading', { name: 'Discard your changes?' });
const footer = () => within(screen.getByTestId('modal-footer'));

describe('CancelEventModal (ROK-536)', () => {
    it('pre-populates reason textarea when initialReason is provided', () => {
        renderModal({ initialReason: 'Not enough tanks' });
        const textarea = screen.getByPlaceholderText(/scheduling conflict/i) as HTMLTextAreaElement;
        expect(textarea.value).toBe('Not enough tanks');
    });

    it('reason textarea is empty when no initialReason', () => {
        renderModal();
        const textarea = screen.getByPlaceholderText(/scheduling conflict/i) as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
    });

    it('a cleared deep-linked reason stays cleared (no render-time refill)', () => {
        renderModal({ initialReason: 'Not enough tanks' });
        type('');
        expect(reasonBox().value).toBe('');
    });
});

describe('CancelEventModal — shared primitives (ROK-1649)', () => {
    it('the reason is a labelled Textarea with id cancel-reason', () => {
        renderModal();
        expect(reasonBox()).toHaveAttribute('id', 'cancel-reason');
        expect(reasonBox()).toHaveAttribute('maxLength', '500');
    });

    it('the Textarea counter reads 0/500, then n/500 (one counter only)', () => {
        renderModal();
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('0/500');
        expect(screen.getAllByText('0/500')).toHaveLength(1);
        type('No healers');
        expect(screen.getByTestId('textarea-count')).toHaveTextContent('10/500');
    });

    it('the notify warning uses the warning token', () => {
        renderModal();
        expect(screen.getByText(/All 5 signed-up members will be notified/)).toHaveClass('text-warning');
    });

    it('all three actions sit in the pinned Modal footer', () => {
        renderModal({ gameId: 3 });
        expect(footer().getByRole('button', { name: 'Keep Event' })).toBeInTheDocument();
        expect(footer().getByRole('button', { name: 'Cancel Event' })).toBeInTheDocument();
        expect(footer().getByRole('button', { name: 'Convert to Poll' })).toBeInTheDocument();
    });

    it('a pending Cancel Event has aria-disabled + aria-busy and swallows the click', () => {
        m.cancel.isPending = true;
        renderModal();
        const btn = screen.getByRole('button', { name: 'Cancelling...' });
        expect(btn).toHaveAttribute('aria-disabled', 'true');
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(m.cancel.mutateAsync).not.toHaveBeenCalled();
    });

    it('a pending Convert to Poll reads Creating poll... and is busy', () => {
        m.poll.isPending = true;
        renderModal({ gameId: 3 });
        const btn = screen.getByRole('button', { name: 'Creating poll...' });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(m.poll.mutateAsync).not.toHaveBeenCalled();
    });

    it('Convert is disabled with no gameId, enabled with one', () => {
        const { unmount } = renderModal();
        expect(screen.getByRole('button', { name: 'Convert to Poll' })).toBeDisabled();
        unmount();
        renderModal({ gameId: 3 });
        expect(screen.getByRole('button', { name: 'Convert to Poll' })).toBeEnabled();
    });
});

describe('CancelEventModal — dirty-close guard (ROK-1655)', () => {
    it('a dirty Escape asks first; Keep editing keeps the text', () => {
        const { onClose } = renderModal();
        type('Raid leader sick');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(discardHeading()).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(discardHeading()).not.toBeInTheDocument();
        expect(reasonBox().value).toBe('Raid leader sick');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a dirty Escape then Discard calls onClose once', () => {
        const { onClose } = renderModal();
        type('Raid leader sick');
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a dirty Keep Event asks first', () => {
        const { onClose } = renderModal();
        type('Raid leader sick');
        fireEvent.click(screen.getByRole('button', { name: 'Keep Event' }));
        expect(discardHeading()).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a clean Keep Event closes with no confirm', () => {
        const { onClose } = renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Keep Event' }));
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('an unchanged initialReason counts as clean', () => {
        const { onClose } = renderModal({ initialReason: 'Not enough tanks' });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a dirty successful Cancel Event closes directly with the reason', async () => {
        const { onClose } = renderModal();
        type('Raid leader sick');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel Event' })); });
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(m.cancel.mutateAsync).toHaveBeenCalledWith('Raid leader sick');
    });

    it('a dirty successful Convert to Poll closes directly', async () => {
        const { onClose } = renderModal({ gameId: 3 });
        type('Raid leader sick');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Convert to Poll' })); });
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(m.poll.mutateAsync).toHaveBeenCalledWith({ gameId: 3, linkedEventId: 1, durationHours: 72 });
    });
});
