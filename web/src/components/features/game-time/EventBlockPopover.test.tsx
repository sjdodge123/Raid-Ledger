import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventBlockPopover } from './EventBlockPopover';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../hooks/use-signups', () => ({
    useCancelSignup: () => ({
        mutateAsync: vi.fn(),
        isPending: false,
    }),
}));

vi.mock('../../events/signup-confirmation-modal', () => ({
    SignupConfirmationModal: () => <div data-testid="confirm-modal" />,
}));

const mockEvent = {
    eventId: 5,
    title: 'Mythic Raid',
    gameSlug: 'wow',
    gameName: 'World of Warcraft',
    coverUrl: null,
    signupId: 10,
    confirmationStatus: 'pending' as const,
    dayOfWeek: 2,
    startHour: 19,
    endHour: 22,
};

const mockAnchorRect = new DOMRect(100, 200, 80, 60);

function renderPopover(onClose = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <EventBlockPopover
                    event={mockEvent}
                    anchorRect={mockAnchorRect}
                    onClose={onClose}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('EventBlockPopover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders event title and game name', () => {
        renderPopover();
        expect(screen.getByText('Mythic Raid')).toBeInTheDocument();
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });

    it('renders status badge', () => {
        renderPopover();
        expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('View Event button navigates correctly', () => {
        const onClose = vi.fn();
        renderPopover(onClose);

        fireEvent.click(screen.getByText('View Event'));
        expect(mockNavigate).toHaveBeenCalledWith('/events/5');
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on click outside', () => {
        const onClose = vi.fn();
        renderPopover(onClose);

        // Click outside the popover
        fireEvent.pointerDown(document.body);
        expect(onClose).toHaveBeenCalled();
    });
});
