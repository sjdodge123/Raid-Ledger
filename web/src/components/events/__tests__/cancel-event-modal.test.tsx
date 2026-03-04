/**
 * cancel-event-modal.test.tsx
 *
 * Tests for CancelEventModal initialReason prop (ROK-536).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancelEventModal } from '../cancel-event-modal';

// Mock the hooks used by CancelEventModal
vi.mock('../../../hooks/use-events', () => ({
    useCancelEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/use-event-plans', () => ({
    useConvertEventToPlan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderModal(props: Partial<React.ComponentProps<typeof CancelEventModal>> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <MemoryRouter>
                <CancelEventModal
                    isOpen={true}
                    onClose={vi.fn()}
                    eventId={1}
                    eventTitle="Test Event"
                    signupCount={5}
                    {...props}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

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
});
