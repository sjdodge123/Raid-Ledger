/**
 * RescheduleModal — ROK-1588 lane R rewrote the grid cases: the picker is the
 * shared week-columns view (desktop) / group day module (phone). Time is pinned
 * to Wed Sep 16 2026 12:00 LOCAL so every assertion is TZ-agnostic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RescheduleModal } from './RescheduleModal';
import { useAggregateGameTime } from '../../hooks/use-reschedule';

const mockMutateAsync = vi.fn();
const mockPollMutateAsync = vi.hoisted(() => vi.fn());
/** ROK-1649 B8: flip a mutation's `isPending` per test (reset in `setup`). */
const pending = vi.hoisted(() => ({ reschedule: false, poll: false }));
vi.mock('../../hooks/use-reschedule', () => ({
    useAggregateGameTime: vi.fn(() => ({
        data: {
            eventId: 42,
            totalUsers: 5,
            cells: [
                { dayOfWeek: 3, hour: 20, availableCount: 5, totalCount: 5 },
                { dayOfWeek: 4, hour: 21, availableCount: 4, totalCount: 5 },
            ],
        },
        isLoading: false,
    })),
    useRescheduleEvent: vi.fn(() => ({
        mutateAsync: mockMutateAsync,
        isPending: pending.reschedule,
    })),
}));

vi.mock('../../hooks/use-standalone-poll', () => ({
    useCreateSchedulingPoll: vi.fn(() => ({ mutateAsync: mockPollMutateAsync, isPending: pending.poll })),
}));

vi.mock('../../hooks/use-game-time', () => ({
    useGameTime: vi.fn(() => ({ data: { slots: [] } })),
}));

const media = vi.hoisted(() => ({ phone: false }));
vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: vi.fn((query: string) => (query === '(max-width: 1023px)' ? media.phone : !media.phone)),
}));

vi.mock('../lineups/cycle-4/PhoneGroupAvailability', () => ({
    PhoneGroupAvailability: ({ onPickHour }: { onPickHour: (d: number, h: number) => void }) => (
        <div data-testid="phone-group-availability">
            <button type="button" onClick={() => onPickHour(4, 21)}>phone-pick</button>
        </div>
    ),
}));

// Mock useConvertEventToPlan hook
vi.mock('../../hooks/use-event-plans', () => ({
    useConvertEventToPlan: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
    })),
}));

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock useFocusTrap to eliminate requestAnimationFrame timing issues
vi.mock('../../hooks/use-focus-trap', () => ({
    useFocusTrap: () => ({ current: null }),
}));

let activeQueryClient: QueryClient;

function createWrapper() {
    activeQueryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <MemoryRouter>
                <QueryClientProvider client={activeQueryClient}>
                    {children}
                </QueryClientProvider>
            </MemoryRouter>
        );
    };
}

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    eventId: 42,
    currentStartTime: new Date(2026, 8, 23, 20).toISOString(), // Wed Sep 23 2026, 8 PM local
    currentEndTime: new Date(2026, 8, 23, 22).toISOString(),   // 2 hour event
    eventTitle: 'Raid Night',
};

type RescheduleModalProps = React.ComponentProps<typeof RescheduleModal>;

function renderModal(overrides: Partial<RescheduleModalProps> = {}) {
    const props = { ...defaultProps, ...overrides };
    return render(<RescheduleModal {...props} />, { wrapper: createWrapper() });
}

const NOW = new Date(2026, 8, 16, 12, 0);

function setup() {
    vi.clearAllMocks();
    media.phone = false;
    pending.reschedule = false;
    pending.poll = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
}
function teardown() {
    vi.useRealTimers();
    activeQueryClient?.clear();
}

const startInput = () => screen.getByLabelText('New start') as HTMLInputElement;
const cell = (day: number, hour: number) => screen.getByTestId(`group-week-cell-${day}-${hour}`);

describe('RescheduleModal — rendering', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('renders the modal title', () => {
        renderModal();
        expect(screen.getByText('Reschedule Event')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        renderModal({ isOpen: false });
        expect(screen.queryByText('Reschedule Event')).not.toBeInTheDocument();
    });

    it('mounts the shared week view on desktop, not the retired GameTimeGrid', () => {
        renderModal();
        expect(screen.getByTestId('group-week-view')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
        expect(screen.queryByText('Few')).not.toBeInTheDocument();
    });

    it('notes the current start', () => {
        renderModal();
        expect(screen.getByTestId('reschedule-current')).toHaveTextContent('Currently Wed Sep 23, 8 PM.');
    });

    it('still offers Poll for Best Time', () => {
        renderModal({ gameId: 7 });
        expect(screen.getByRole('button', { name: 'Poll for Best Time' })).toBeInTheDocument();
    });

    it('keeps the loading copy', () => {
        vi.mocked(useAggregateGameTime).mockReturnValueOnce(
            { data: undefined, isLoading: true } as unknown as ReturnType<typeof useAggregateGameTime>,
        );
        renderModal();
        expect(screen.getByText('Loading availability data...')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
    });

    it('keeps the zero-signup copy', () => {
        vi.mocked(useAggregateGameTime).mockReturnValueOnce(
            { data: { eventId: 42, totalUsers: 0, cells: [] }, isLoading: false } as unknown as ReturnType<typeof useAggregateGameTime>,
        );
        renderModal();
        expect(screen.getByText('No players signed up yet -- no availability data to display.')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
    });
});

describe('RescheduleModal — picking a cell', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('fills the start input with the displayed week\'s date, not the next occurrence', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        expect(startInput().value).toBe('2026-09-24T21:00');
        expect(cell(4, 21)).toHaveAttribute('data-picked', 'true');
    });

    it('ignores a click on the current event\'s cell', () => {
        renderModal();
        expect(cell(3, 20)).toHaveAttribute('data-current', 'true');
        fireEvent.click(cell(3, 20));
        expect(startInput().value).toBe('');
        expect(screen.queryByRole('button', { name: /^Move to/ })).not.toBeInTheDocument();
    });

    it('disables past cells', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
        expect(cell(1, 20)).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(cell(1, 20));
        expect(startInput().value).toBe('');
    });

    it('the confirm button reads "Move to <day date, time>"', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        expect(screen.getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('Clear resets the selection', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.queryByRole('button', { name: /^Move to/ })).not.toBeInTheDocument();
        expect(cell(4, 21)).not.toHaveAttribute('data-picked');
    });

    it('typing a start by hand clears the picked cell', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        fireEvent.change(startInput(), { target: { value: '2026-09-24T21:30' } });
        expect(cell(4, 21)).not.toHaveAttribute('data-picked');
        expect(screen.getByRole('button', { name: 'Move to Thu Sep 24, 9:30 PM' })).toBeInTheDocument();
    });

    it('confirming reschedules to the picked instant', async () => {
        mockMutateAsync.mockResolvedValueOnce({});
        renderModal();
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' }));
        expect(mockMutateAsync).toHaveBeenCalledWith({
            startTime: new Date(2026, 8, 24, 21).toISOString(),
            endTime: new Date(2026, 8, 24, 23).toISOString(),
        });
    });
});

describe('RescheduleModal — phone', () => {
    beforeEach(() => { setup(); media.phone = true; });
    afterEach(teardown);

    it('the bottom sheet mounts the group day module', () => {
        renderModal();
        expect(screen.getByTestId('phone-group-availability')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });

    it('a tap fills the start input with the displayed week\'s date', () => {
        renderModal();
        fireEvent.click(screen.getByText('phone-pick'));
        expect(startInput().value).toBe('2026-09-24T21:00');
    });
});

describe('RescheduleModal — duration and manual input', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('renders the duration presets as radios in a group named Duration', () => {
        renderModal();
        const group = screen.getByRole('radiogroup', { name: 'Duration' });
        for (const label of ['1h', '1.5h', '2h', '3h', '4h', 'Custom']) {
            expect(within(group).getByRole('radio', { name: label })).toBeInTheDocument();
        }
        expect(within(group).getAllByRole('radio')).toHaveLength(6);
    });

    it('original duration preset is checked by default', () => {
        renderModal();
        expect(screen.getByRole('radio', { name: '2h' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Custom' })).not.toBeChecked();
    });

    it('clicking a different preset changes the active selection', () => {
        renderModal();
        fireEvent.click(screen.getByRole('radio', { name: '3h' }));
        expect(screen.getByRole('radio', { name: '3h' })).toBeChecked();
        expect(screen.getByRole('radio', { name: '2h' })).not.toBeChecked();
    });

    it('clicking Custom shows named hour/minute spinbuttons', () => {
        renderModal();
        expect(screen.queryByRole('spinbutton', { name: 'Duration hours' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked();
        expect(screen.getByRole('spinbutton', { name: 'Duration hours' })).toHaveValue(2);
        expect(screen.getByRole('spinbutton', { name: 'Duration minutes' })).toHaveValue(0);
        expect(screen.getByText('hr')).toBeInTheDocument();
        expect(screen.getByText('min')).toBeInTheDocument();
    });

    it('a custom duration sets the rescheduled end', () => {
        mockMutateAsync.mockResolvedValueOnce({});
        renderModal();
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration hours' }), { target: { value: '3' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration minutes' }), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' }));
        expect(mockMutateAsync).toHaveBeenCalledWith({
            startTime: new Date(2026, 8, 24, 21).toISOString(),
            endTime: new Date(2026, 8, 25, 0, 30).toISOString(),
        });
    });

    it('renders datetime-local input for manual start time', () => {
        renderModal();
        expect(startInput().type).toBe('datetime-local');
        expect(startInput()).toHaveAttribute('id', 'reschedule-start');
    });
});

describe('RescheduleModal — buttons and messages (ROK-1649 B8)', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('Poll for Best Time shows Converting... while pending and swallows the click', () => {
        pending.poll = true;
        renderModal({ gameId: 7 });
        const btn = screen.getByRole('button', { name: 'Converting...' });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(mockPollMutateAsync).not.toHaveBeenCalled();
    });

    it('Poll for Best Time stays disabled without a game', () => {
        renderModal();
        expect(screen.getByRole('button', { name: 'Poll for Best Time' })).toBeDisabled();
    });

    it('the confirm button shows Rescheduling... while pending and swallows the click', () => {
        pending.reschedule = true;
        renderModal();
        fireEvent.click(cell(4, 21));
        const btn = screen.getByRole('button', { name: 'Rescheduling...' });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(btn);
        expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('a past start disables Move to and explains in the danger token', () => {
        renderModal();
        fireEvent.change(startInput(), { target: { value: '2026-09-10T20:00' } });
        expect(screen.getByText('Start time must be in the future')).toHaveClass('text-danger');
        expect(screen.getByRole('button', { name: 'Move to Thu Sep 10, 8 PM' })).toBeDisabled();
    });

    it('the picked time reads in the success token', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        expect(screen.getByText('Raid Night').nextElementSibling).toHaveClass('text-success');
    });
});

describe('RescheduleModal — close behavior', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('calls onClose when modal close button is clicked', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets selection state on close (a pick is dirty, so the close goes through Discard)', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByLabelText('Close modal'));
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(startInput().value).toBe('');
    });
});

const discardHeading = () => screen.queryByRole('heading', { name: 'Discard your changes?' });

describe('RescheduleModal — dirty-close guard (ROK-1655 AC1)', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('a dirty × asks first; Keep editing keeps the picked start', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(discardHeading()).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(discardHeading()).not.toBeInTheDocument();
        expect(startInput().value).toBe('2026-09-24T21:00');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a duration-only change is dirty: Escape asks, Discard closes once', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByRole('radio', { name: '3h' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(discardHeading()).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a duration put back to the original is clean and closes at once', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByRole('radio', { name: '3h' }));
        fireEvent.click(screen.getByRole('radio', { name: '2h' }));
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Discard drops the duration too, so the next open starts clean', () => {
        const onClose = vi.fn();
        const { rerender } = renderModal({ onClose });
        fireEvent.click(screen.getByRole('radio', { name: '3h' }));
        fireEvent.click(screen.getByLabelText('Close modal'));
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        rerender(<RescheduleModal {...defaultProps} onClose={onClose} isOpen={false} />);
        rerender(<RescheduleModal {...defaultProps} onClose={onClose} isOpen />);
        expect(screen.getByRole('radio', { name: '2h' })).toBeChecked();
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(2);
    });

});

describe('RescheduleModal — success paths close directly (ROK-1655)', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('a successful reschedule closes directly, not through the confirm', async () => {
        mockMutateAsync.mockResolvedValueOnce({});
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(discardHeading()).not.toBeInTheDocument();
    });

    it('a successful Poll for Best Time closes directly, not through the confirm', async () => {
        mockPollMutateAsync.mockResolvedValueOnce({ id: 9, lineupId: 3 });
        const onClose = vi.fn();
        renderModal({ onClose, gameId: 7 });
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByRole('button', { name: 'Poll for Best Time' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(discardHeading()).not.toBeInTheDocument();
    });
});

describe('RescheduleModal — pinned footer (ROK-1655 AC2)', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('no footer until a start is picked', () => {
        renderModal();
        expect(screen.queryByTestId('modal-footer')).not.toBeInTheDocument();
    });

    it('the confirmation bar sits in the Modal footer, outside the scroll body', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        const footer = screen.getByTestId('modal-footer');
        expect(within(footer).getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' })).toBeInTheDocument();
        expect(within(footer).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
        expect(footer.contains(startInput())).toBe(false);
    });
});

describe('RescheduleModal — phone guard and footer (ROK-1655)', () => {
    beforeEach(() => { setup(); media.phone = true; });
    afterEach(teardown);

    const sheet = () => screen.getByRole('dialog', { name: 'Reschedule Event' });
    function swipeDown() {
        const handle = sheet().querySelector('.cursor-grab') as HTMLElement;
        fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 300 }] });
        fireEvent.touchMove(handle, { touches: [{ clientX: 0, clientY: 500 }] });
        fireEvent.touchEnd(handle);
    }

    it('a dirty swipe-down asks first; Keep editing keeps the pick', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByText('phone-pick'));
        swipeDown();
        expect(discardHeading()).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(startInput().value).toBe('2026-09-24T21:00');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a dirty sheet × asks first; Discard closes once', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(screen.getByText('phone-pick'));
        fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
        expect(discardHeading()).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a clean swipe-down closes at once', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        swipeDown();
        expect(discardHeading()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the confirmation bar sits in the sheet footer, outside the scroll body', () => {
        renderModal();
        fireEvent.click(screen.getByText('phone-pick'));
        const footer = screen.getByTestId('bottom-sheet-footer');
        expect(within(footer).getByRole('button', { name: 'Move to Thu Sep 24, 9 PM' })).toBeInTheDocument();
        expect(footer.contains(startInput())).toBe(false);
    });
});
