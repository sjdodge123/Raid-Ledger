import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RescheduleModal } from './RescheduleModal';

// Mock the reschedule hooks
const mockMutateAsync = vi.fn();
vi.mock('../../hooks/use-reschedule', () => ({
    useAggregateGameTime: vi.fn(() => ({
        data: {
            totalUsers: 5,
            cells: [
                { dayOfWeek: 0, hour: 18, availableCount: 3, totalCount: 5 },
                { dayOfWeek: 0, hour: 19, availableCount: 4, totalCount: 5 },
                { dayOfWeek: 3, hour: 20, availableCount: 5, totalCount: 5 },
            ],
        },
        isLoading: false,
    })),
    useRescheduleEvent: vi.fn(() => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
    })),
}));

// Mock useNavigate from react-router-dom
vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(() => vi.fn()),
}));

// Mock useConvertEventToPlan hook
vi.mock('../../hooks/use-event-plans', () => ({
    useConvertEventToPlan: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
    })),
}));

// Mock useMediaQuery to return desktop by default
vi.mock('../../hooks/use-media-query', () => ({
    useMediaQuery: vi.fn(() => false), // false = desktop
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
            <QueryClientProvider client={activeQueryClient}>
                {children}
            </QueryClientProvider>
        );
    };
}

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    eventId: 42,
    currentStartTime: '2026-02-25T20:00:00.000Z', // Wednesday 8 PM UTC
    currentEndTime: '2026-02-25T22:00:00.000Z',   // Wednesday 10 PM UTC (2 hour event)
    eventTitle: 'Raid Night',
};

type RescheduleModalProps = React.ComponentProps<typeof RescheduleModal>;

function renderModal(overrides: Partial<RescheduleModalProps> = {}) {
    const props = { ...defaultProps, ...overrides };
    return render(<RescheduleModal {...props} />, { wrapper: createWrapper() });
}

describe('RescheduleModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    describe('rendering', () => {
        it('renders the modal title', () => {
            renderModal();
            expect(screen.getByText('Reschedule Event')).toBeInTheDocument();
        });

        it('shows availability instruction text with signup count', () => {
            renderModal();
            expect(screen.getByText(/Click a cell to select a new time/)).toBeInTheDocument();
            expect(screen.getByText(/5 signed up/)).toBeInTheDocument();
        });

        it('renders the heatmap legend', () => {
            renderModal();
            expect(screen.getByText('Few')).toBeInTheDocument();
            expect(screen.getByText('Some')).toBeInTheDocument();
            expect(screen.getByText('All available')).toBeInTheDocument();
        });

        it('renders a GameTimeGrid with data-testid', () => {
            renderModal();
            expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        });

        it('does not render when isOpen is false', () => {
            renderModal({ isOpen: false });
            expect(screen.queryByText('Reschedule Event')).not.toBeInTheDocument();
        });
    });

    describe('compact prop is passed to GameTimeGrid (ROK-370)', () => {
        it('grid cells use compact (h-4) height inside the modal', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            // Grab a cell within the data-driven range (heatmap has hour 18)
            const cell = within(grid).getByTestId('cell-0-18');
            expect(cell.className).toContain('h-4');
            expect(cell.className).not.toContain('h-5');
        });

        it('all visible cells in the modal grid use compact height', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            // Check cells within the data-driven range (heatmap 18-20, event 20-22 → range ~17-23)
            const cellIds = ['cell-0-18', 'cell-3-20', 'cell-6-21'];
            for (const id of cellIds) {
                const cell = within(grid).getByTestId(id);
                expect(cell.className).toContain('h-4');
            }
        });
    });

    describe('full 24h scrollable grid (ROK-475)', () => {
        it('grid renders all 24 hours (no hourRange filtering)', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            // All hours 0-23 should be rendered for any day
            for (let h = 0; h < 24; h++) {
                expect(within(grid).getByTestId(`cell-0-${h}`)).toBeInTheDocument();
            }
        });

        it('grid includes heatmap hours', () => {
            // Heatmap has cells at hours 18, 19, 20 — all should be visible
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            expect(within(grid).getByTestId('cell-0-18')).toBeInTheDocument();
            expect(within(grid).getByTestId('cell-0-19')).toBeInTheDocument();
            expect(within(grid).getByTestId('cell-3-20')).toBeInTheDocument();
        });
    });

    describe('cell click interaction', () => {
        it('clicking a grid cell populates the start time input', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            // After clicking, the start input should have a value
            const input = screen.getByLabelText('New start') as HTMLInputElement;
            expect(input.value).not.toBe('');
        });

        it('clicking the current event cell does not select it', () => {
            // currentStartTime = Wed 8PM UTC, so currentDayOfWeek and currentHour
            // depend on local timezone, but the click guard checks dayOfWeek + hour
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            const currentDay = new Date(defaultProps.currentStartTime).getDay();
            const currentHour = new Date(defaultProps.currentStartTime).getHours();
            fireEvent.click(within(grid).getByTestId(`cell-${currentDay}-${currentHour}`));
            // Confirm button should NOT appear since same cell as current
            expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
        });

        it('selecting a cell shows the New time legend item', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            expect(screen.getByText('New time')).toBeInTheDocument();
        });

        it('selecting a cell shows Confirm and Clear buttons', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            expect(screen.getByText('Confirm')).toBeInTheDocument();
            expect(screen.getByText('Clear')).toBeInTheDocument();
        });

        it('Clear button resets the selection', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            expect(screen.getByText('Confirm')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Clear'));
            expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
            expect(screen.queryByText('New time')).not.toBeInTheDocument();
        });
    });

    describe('duration presets', () => {
        it('renders duration preset buttons', () => {
            renderModal();
            // Use getAllByRole to find buttons specifically, avoiding DurationBadge spans
            const buttons = screen.getAllByRole('button');
            const presetLabels = buttons.map(b => b.textContent?.trim());
            expect(presetLabels).toContain('1h');
            expect(presetLabels).toContain('1.5h');
            expect(presetLabels).toContain('2h');
            expect(presetLabels).toContain('3h');
            expect(presetLabels).toContain('4h');
            expect(presetLabels).toContain('Custom');
        });

        it('original duration preset is highlighted by default', () => {
            // Default event is 2 hours — find the 2h button (not the DurationBadge span)
            renderModal();
            const buttons = screen.getAllByRole('button');
            const btn2h = buttons.find(b => b.textContent?.trim() === '2h' && (b as HTMLButtonElement).type === 'button');
            expect(btn2h).toBeDefined();
            expect(btn2h!.className).toContain('bg-emerald-600');
        });

        it('clicking a different preset changes the active selection', () => {
            renderModal();
            const btn3h = screen.getByText('3h');
            fireEvent.click(btn3h);
            expect(btn3h.className).toContain('bg-emerald-600');
            // 2h should no longer be highlighted
            const btn2h = screen.getByText('2h');
            expect(btn2h.className).not.toContain('bg-emerald-600');
        });

        it('clicking Custom shows hour/minute inputs', () => {
            renderModal();
            fireEvent.click(screen.getByText('Custom'));
            expect(screen.getByText('hr')).toBeInTheDocument();
            expect(screen.getByText('min')).toBeInTheDocument();
        });
    });

    describe('manual time input', () => {
        it('renders datetime-local input for manual start time', () => {
            renderModal();
            const input = screen.getByLabelText('New start') as HTMLInputElement;
            expect(input.type).toBe('datetime-local');
        });

        it('typing in the input clears grid selection', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            // First select via grid
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            expect(screen.getByText('New time')).toBeInTheDocument();

            // Now change via input — should clear grid selection (no "New time" legend)
            const input = screen.getByLabelText('New start') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '2026-03-01T15:00' } });
            expect(screen.queryByText('New time')).not.toBeInTheDocument();
        });
    });

    describe('event block rendering in grid', () => {
        it('renders the current event block in the grid', () => {
            renderModal();
            // The current event is rendered as a GameTimeEventBlock
            const currentDay = new Date(defaultProps.currentStartTime).getDay();
            const block = screen.getByTestId(`event-block-42-${currentDay}`);
            expect(block).toBeInTheDocument();
        });
    });

    describe('game metadata passthrough', () => {
        it('passes game metadata to current event blocks', () => {
            renderModal({
                gameSlug: 'world-of-warcraft',
                gameName: 'World of Warcraft',
            });
            const currentDay = new Date(defaultProps.currentStartTime).getDay();
            const block = screen.getByTestId(`event-block-42-${currentDay}`);
            expect(block).toBeInTheDocument();
            // Title should include event title and game name
            expect(block.title).toContain('Raid Night');
            expect(block.title).toContain('World of Warcraft');
        });
    });

    describe('close behavior', () => {
        it('calls onClose when modal close button is clicked', () => {
            const onClose = vi.fn();
            renderModal({ onClose });
            fireEvent.click(screen.getByLabelText('Close modal'));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('resets selection state on close', () => {
            const onClose = vi.fn();
            renderModal({ onClose });
            const grid = screen.getByTestId('game-time-grid');
            fireEvent.click(within(grid).getByTestId('cell-5-18'));
            expect(screen.getByText('Confirm')).toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('Close modal'));
            expect(onClose).toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------
// ROK-475: Full 24h scrollable grid tests
// ---------------------------------------------------------------------------

import { useAggregateGameTime } from '../../hooks/use-reschedule';

describe('ROK-475: full 24h scrollable grid', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        activeQueryClient?.clear();
    });

    it('renders all 24 hours regardless of availability data range', () => {
        // Data covers only hour 20, but grid should still show all 24 hours
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                cells: [{ dayOfWeek: 0, hour: 20, availableCount: 3, totalCount: 3 }],
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T20:00:00.000Z',
            currentEndTime: '2026-02-25T21:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        for (let h = 0; h < 24; h++) {
            expect(within(grid).getByTestId(`cell-0-${h}`)).toBeInTheDocument();
        }
    });

    it('shows "no players" message and hides the grid when signups are 0', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 0, cells: [] },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal();

        expect(screen.getByText(/No players signed up yet/)).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });

    it('current event block is rendered in the grid', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 2,
                cells: [{ dayOfWeek: 0, hour: 10, availableCount: 2, totalCount: 2 }],
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T10:00:00.000Z',
            currentEndTime: '2026-02-25T11:00:00.000Z',
        });

        const currentDay = new Date('2026-02-25T10:00:00.000Z').getDay();
        expect(screen.getByTestId(`event-block-42-${currentDay}`)).toBeInTheDocument();
    });

    it('heatmap cells are rendered at the correct positions', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [
                    { dayOfWeek: 0, hour: 18, availableCount: 4, totalCount: 5 },
                    { dayOfWeek: 0, hour: 19, availableCount: 5, totalCount: 5 },
                    { dayOfWeek: 3, hour: 20, availableCount: 3, totalCount: 5 },
                ],
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal();

        const grid = screen.getByTestId('game-time-grid');
        expect(within(grid).getByTestId('cell-0-18')).toBeInTheDocument();
        expect(within(grid).getByTestId('cell-0-19')).toBeInTheDocument();
        expect(within(grid).getByTestId('cell-3-20')).toBeInTheDocument();
    });

    it('shows signup count in the instruction text', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 7,
                cells: [{ dayOfWeek: 0, hour: 19, availableCount: 5, totalCount: 7 }],
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByText(/7 signed up/)).toBeInTheDocument();
    });

    it('does not render the grid when loading', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: undefined,
            isLoading: true,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByText(/Loading availability data/)).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });

    it('uses GameTimeGrid (not TeamAvailabilityPicker) for the heatmap', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [{ dayOfWeek: 0, hour: 18, availableCount: 4, totalCount: 5 }],
            },
            isLoading: false,
        } as unknown as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('team-availability-picker')).not.toBeInTheDocument();
    });
});
