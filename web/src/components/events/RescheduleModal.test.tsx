/**
 * RescheduleModal — ROK-1588 lane R rewrote the grid cases: the picker is the
 * shared week-columns view (desktop) / group day module (phone). Time is pinned
 * to Wed Sep 16 2026 12:00 LOCAL so every assertion is TZ-agnostic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RescheduleModal } from './RescheduleModal';
import { useAggregateGameTime } from '../../hooks/use-reschedule';

const mockMutateAsync = vi.fn();
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
        isPending: false,
    })),
}));

vi.mock('../../hooks/use-standalone-poll', () => ({
    useCreateSchedulingPoll: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
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
        expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('Clear resets the selection', () => {
        renderModal();
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByText('Clear'));
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

    it('renders duration preset buttons', () => {
        renderModal();
        const presetLabels = screen.getAllByRole('button').map(b => b.textContent?.trim());
        for (const label of ['1h', '1.5h', '2h', '3h', '4h', 'Custom']) expect(presetLabels).toContain(label);
    });

    it('original duration preset is highlighted by default', () => {
        renderModal();
        expect(screen.getByText('2h').className).toContain('bg-emerald-600');
    });

    it('clicking a different preset changes the active selection', () => {
        renderModal();
        fireEvent.click(screen.getByText('3h'));
        expect(screen.getByText('3h').className).toContain('bg-emerald-600');
        expect(screen.getByText('2h').className).not.toContain('bg-emerald-600');
    });

    it('clicking Custom shows hour/minute inputs', () => {
        renderModal();
        fireEvent.click(screen.getByText('Custom'));
        expect(screen.getByText('hr')).toBeInTheDocument();
        expect(screen.getByText('min')).toBeInTheDocument();
    });

    it('renders datetime-local input for manual start time', () => {
        renderModal();
        expect(startInput().type).toBe('datetime-local');
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

    it('resets selection state on close', () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        fireEvent.click(cell(4, 21));
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(onClose).toHaveBeenCalled();
        expect(startInput().value).toBe('');
    });
});
