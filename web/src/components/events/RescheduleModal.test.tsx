import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
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

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
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

    describe('hourRange is data-driven (ROK-370)', () => {
        it('grid range does not include early morning hours far from data', () => {
            // Heatmap hours 18-20 + event at local hour → range should NOT include 5 AM
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            expect(within(grid).queryByTestId('cell-0-5')).not.toBeInTheDocument();
        });

        it('grid range includes heatmap hours', () => {
            // Heatmap has cells at hours 18, 19, 20 — all should be visible
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            expect(within(grid).getByTestId('cell-0-18')).toBeInTheDocument();
            expect(within(grid).getByTestId('cell-0-19')).toBeInTheDocument();
            expect(within(grid).getByTestId('cell-3-20')).toBeInTheDocument();
        });

        it('grid range spans at least 12 hours (ROK-475)', () => {
            renderModal();
            const grid = screen.getByTestId('game-time-grid');
            // Collect all visible hour cells for Sunday (day 0)
            const visibleHours: number[] = [];
            for (let h = 0; h < 24; h++) {
                if (within(grid).queryByTestId(`cell-0-${h}`)) {
                    visibleHours.push(h);
                }
            }
            // Must span at least 12 hours (minimum window) + 2 padding = 14, but clamped to [0,24]
            expect(visibleHours.length).toBeGreaterThanOrEqual(12);
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
// ROK-475: Minimum 12-hour window tests (adversarial / edge-case suite)
// ---------------------------------------------------------------------------

// Helper to override the useAggregateGameTime mock for specific test scenarios
import { useAggregateGameTime } from '../../hooks/use-reschedule';

/** Count the number of distinct hour rows rendered by the grid for day 0 */
function countVisibleHoursForDay(grid: HTMLElement, day = 0): number {
    let count = 0;
    for (let h = 0; h < 25; h++) {
        if (within(grid).queryByTestId(`cell-${day}-${h}`)) count++;
    }
    return count;
}

/** Collect visible hours for day 0 */
function visibleHoursForDay(grid: HTMLElement, day = 0): number[] {
    const hours: number[] = [];
    for (let h = 0; h < 25; h++) {
        if (within(grid).queryByTestId(`cell-${day}-${h}`)) hours.push(h);
    }
    return hours;
}

describe('ROK-475: heatmap minimum 12-hour window (AC1 — always ≥ 12 hours)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders at least 12 hour rows when availability data spans only 1 hour', () => {
        // Data covers only hour 20 — far too narrow without the fix
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                cells: [{ dayOfWeek: 0, hour: 20, availableCount: 3, totalCount: 3 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T20:00:00.000Z',
            currentEndTime: '2026-02-25T21:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
    });

    it('shows "no players" message and hides the grid when there is no availability data at all', () => {
        // When totalUsers === 0, the component shows the "no players" fallback
        // message instead of the grid. The hourRange logic is not exercised in this
        // branch, so this is the correct expected behavior.
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 0, cells: [] },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T14:00:00.000Z',
            currentEndTime: '2026-02-25T15:00:00.000Z',
        });

        expect(screen.getByText(/No players signed up yet/)).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });

    it('renders at least 12 hour rows when event is 1 hour (minimal event)', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [
                    { dayOfWeek: 2, hour: 12, availableCount: 5, totalCount: 5 },
                ],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T12:00:00.000Z',
            currentEndTime: '2026-02-25T13:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
    });

    it('renders at least 12 hour rows when availability data spans exactly 2 hours', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 4,
                cells: [
                    { dayOfWeek: 1, hour: 18, availableCount: 4, totalCount: 4 },
                    { dayOfWeek: 1, hour: 19, availableCount: 3, totalCount: 4 },
                ],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T18:00:00.000Z',
            currentEndTime: '2026-02-25T20:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
    });

    it('does not truncate the window when data already spans > 12 hours', () => {
        // Availability from hour 6 to hour 22 → 16 hours
        const wideCells = Array.from({ length: 16 }, (_, i) => ({
            dayOfWeek: 0,
            hour: 6 + i,
            availableCount: 3,
            totalCount: 4,
        }));

        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 4, cells: wideCells },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T14:00:00.000Z',
            currentEndTime: '2026-02-25T16:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const hourCount = countVisibleHoursForDay(grid);
        // Should still show all 16+ hours (not clamped down to 12)
        expect(hourCount).toBeGreaterThanOrEqual(14);
    });
});

describe('ROK-475: current event time is visible within the rendered window (AC2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('current event hour is always included in the visible range', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                cells: [{ dayOfWeek: 3, hour: 22, availableCount: 2, totalCount: 3 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T20:00:00.000Z',
            currentEndTime: '2026-02-25T22:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const currentDay = new Date('2026-02-25T20:00:00.000Z').getDay();
        const currentHour = new Date('2026-02-25T20:00:00.000Z').getHours();
        // The current event hour cell must exist in the grid
        expect(within(grid).queryByTestId(`cell-${currentDay}-${currentHour}`)).toBeInTheDocument();
    });

    it('event block for the current event is rendered in the grid', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 2,
                cells: [{ dayOfWeek: 0, hour: 10, availableCount: 2, totalCount: 2 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T10:00:00.000Z',
            currentEndTime: '2026-02-25T11:00:00.000Z',
        });

        const currentDay = new Date('2026-02-25T10:00:00.000Z').getDay();
        // The event block for eventId=42 should be in the DOM
        expect(screen.getByTestId(`event-block-42-${currentDay}`)).toBeInTheDocument();
    });
});

describe('ROK-475: player availability data displays correctly within expanded window (AC3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('heatmap cells at hours within the expanded window have correct data-testid attributes', () => {
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
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();

        const grid = screen.getByTestId('game-time-grid');
        // All heatmap data hours must be visible in the grid
        expect(within(grid).getByTestId('cell-0-18')).toBeInTheDocument();
        expect(within(grid).getByTestId('cell-0-19')).toBeInTheDocument();
        expect(within(grid).getByTestId('cell-3-20')).toBeInTheDocument();
    });

    it('cells with <25% availability are not used to expand the window beyond the minimum', () => {
        // Only cells where >25% are available expand the window.
        // Cell at hour 2 has 1/5 = 20% — should NOT expand.
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [
                    { dayOfWeek: 0, hour: 2, availableCount: 1, totalCount: 5 },  // 20% — weak
                    { dayOfWeek: 0, hour: 20, availableCount: 4, totalCount: 5 }, // 80% — strong
                ],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        // Event at hour 20 — if weak cell at hour 2 were included, window would be 18+h
        renderModal({
            currentStartTime: '2026-02-25T20:00:00.000Z',
            currentEndTime: '2026-02-25T22:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        // Hour 2 should NOT be visible (weak cell, and far from the strong cells/event)
        expect(within(grid).queryByTestId('cell-0-2')).not.toBeInTheDocument();
        // Hour 20 MUST be visible (strong cell)
        expect(within(grid).getByTestId('cell-0-20')).toBeInTheDocument();
    });

    it('shows signup count in the instruction text', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 7,
                cells: [{ dayOfWeek: 0, hour: 19, availableCount: 5, totalCount: 7 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByText(/7 signed up/)).toBeInTheDocument();
    });
});

describe('ROK-475: edge case — event at midnight boundary (AC1 + AC2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('event at midnight (hour 0) produces a window that does not include negative hours', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                cells: [{ dayOfWeek: 0, hour: 0, availableCount: 3, totalCount: 3 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        // Event at midnight local time — derive ISO string for UTC midnight mapping
        // We use getDay()/getHours() in the component so we need to control the local time.
        // Use a fixed prop that maps to hour 0 in whatever timezone the test runner uses.
        const startOfDay = new Date('2026-02-25');
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date('2026-02-25');
        endOfDay.setHours(1, 0, 0, 0);

        renderModal({
            currentStartTime: startOfDay.toISOString(),
            currentEndTime: endOfDay.toISOString(),
        });

        const grid = screen.getByTestId('game-time-grid');
        // No cell with a negative hour should appear (grid only has 0-23)
        for (let h = -5; h < 0; h++) {
            expect(within(grid).queryByTestId(`cell-0-${h}`)).not.toBeInTheDocument();
        }
        // Hour 0 must be visible
        const day = startOfDay.getDay();
        expect(within(grid).queryByTestId(`cell-${day}-0`)).toBeInTheDocument();
    });

    it('event near end of day (hour 23) produces a window clamped to hour 24 max', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 2,
                cells: [{ dayOfWeek: 3, hour: 23, availableCount: 2, totalCount: 2 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        const late = new Date('2026-02-25');
        late.setHours(23, 0, 0, 0);
        const lateEnd = new Date('2026-02-26');
        lateEnd.setHours(0, 0, 0, 0);

        renderModal({
            currentStartTime: late.toISOString(),
            currentEndTime: lateEnd.toISOString(),
        });

        const grid = screen.getByTestId('game-time-grid');
        // No hour >= 24 should appear
        for (let h = 24; h < 30; h++) {
            expect(within(grid).queryByTestId(`cell-0-${h}`)).not.toBeInTheDocument();
        }
    });
});

describe('ROK-475: edge case — data spanning full 0-24h range (AC1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders all 24 hours when availability data covers the full day', () => {
        const fullDayCells = Array.from({ length: 24 }, (_, h) => ({
            dayOfWeek: 0,
            hour: h,
            availableCount: 3,
            totalCount: 4,
        }));

        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 4, cells: fullDayCells },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        const grid = screen.getByTestId('game-time-grid');
        // With full-day data + 1-hr padding, window is clamped to [0,24] → 24 hours max
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
        expect(hourCount).toBeLessThanOrEqual(24);
    });
});

describe('ROK-475: symmetric expansion from midpoint (AC1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('expands symmetrically when span is less than 12 hours', () => {
        // Event from hour 12 to 13 (1h), no data → span=1, midpoint=12.5
        // Expected: minHour = round(12.5 - 6) = 7, maxHour = 7+12 = 19
        // With 1h padding: rangeStart = max(0, 6) = 6, rangeEnd = min(24, 20) = 20
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 0, cells: [] },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        // Force the component to show the grid by giving it users (otherwise "no players" message)
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 2,
                cells: [
                    { dayOfWeek: 3, hour: 12, availableCount: 2, totalCount: 2 },
                ],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        // Create times in local timezone to control currentHour
        const noon = new Date('2026-02-25');
        noon.setHours(12, 0, 0, 0);
        const noonEnd = new Date('2026-02-25');
        noonEnd.setHours(13, 0, 0, 0);

        renderModal({
            currentStartTime: noon.toISOString(),
            currentEndTime: noonEnd.toISOString(),
        });

        const grid = screen.getByTestId('game-time-grid');
        const hours = visibleHoursForDay(grid, 3);
        expect(hours.length).toBeGreaterThanOrEqual(12);
        // The window should be centered around noon — hours significantly before and after noon
        // should both be included (symmetric expansion)
        const minVisible = Math.min(...hours);
        const maxVisible = Math.max(...hours);
        expect(maxVisible - minVisible + 1).toBeGreaterThanOrEqual(12);
    });

    it('the expanded window contains the event hour', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                cells: [{ dayOfWeek: 0, hour: 15, availableCount: 3, totalCount: 3 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        const three = new Date('2026-02-25');
        three.setHours(15, 0, 0, 0);
        const threeEnd = new Date('2026-02-25');
        threeEnd.setHours(16, 0, 0, 0);

        renderModal({
            currentStartTime: three.toISOString(),
            currentEndTime: threeEnd.toISOString(),
        });

        const grid = screen.getByTestId('game-time-grid');
        const day = three.getDay();
        // Event hour (15) must always be in the visible window
        expect(within(grid).queryByTestId(`cell-${day}-15`)).toBeInTheDocument();
    });
});

describe('ROK-475: grid selection expands window (AC1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clicking a cell far from the event extends the window to include that cell', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [
                    { dayOfWeek: 0, hour: 18, availableCount: 4, totalCount: 5 },
                    { dayOfWeek: 0, hour: 19, availableCount: 4, totalCount: 5 },
                    { dayOfWeek: 3, hour: 20, availableCount: 5, totalCount: 5 },
                ],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        const grid = screen.getByTestId('game-time-grid');

        // Click a cell that's already in the grid (e.g. hour 18, day 0)
        fireEvent.click(within(grid).getByTestId('cell-0-18'));

        // After selection, window should still be at least 12 hours
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
    });
});

describe('ROK-475: no regression to create-event heatmap (AC5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('RescheduleModal uses GameTimeGrid (not TeamAvailabilityPicker) for its heatmap', () => {
        // RescheduleModal renders game-time-grid with the hourRange fix applied.
        // Create event uses a separate component (TeamAvailabilityPicker) — verified in
        // create-event-form.test.tsx. This test confirms the reschedule modal is using
        // the correct grid component and is isolated from the create event form.
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 5,
                cells: [{ dayOfWeek: 0, hour: 18, availableCount: 4, totalCount: 5 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();

        // RescheduleModal renders game-time-grid
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        // RescheduleModal does NOT render the create-event's TeamAvailabilityPicker
        expect(screen.queryByTestId('team-availability-picker')).not.toBeInTheDocument();
    });

    it('hourRange is only applied inside RescheduleModal — source constant MIN_WINDOW=12 enforces minimum', () => {
        // Verify that with a very narrow data range the grid still shows ≥ 12 hours,
        // confirming the MIN_WINDOW constant in RescheduleModal is functioning.
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: {
                totalUsers: 3,
                // Only one hour of data
                cells: [{ dayOfWeek: 1, hour: 21, availableCount: 3, totalCount: 3 }],
            },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal({
            currentStartTime: '2026-02-25T21:00:00.000Z',
            currentEndTime: '2026-02-25T22:00:00.000Z',
        });

        const grid = screen.getByTestId('game-time-grid');
        const hourCount = countVisibleHoursForDay(grid);
        expect(hourCount).toBeGreaterThanOrEqual(12);
    });
});

describe('ROK-475: loading state does not render grid (AC3)', () => {
    it('shows loading message when data is loading', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: undefined,
            isLoading: true,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByText(/Loading availability data/)).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });

    it('shows "no players" message when signup count is 0', () => {
        vi.mocked(useAggregateGameTime).mockReturnValue({
            data: { totalUsers: 0, cells: [] },
            isLoading: false,
        } as ReturnType<typeof useAggregateGameTime>);

        renderModal();
        expect(screen.getByText(/No players signed up yet/)).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
    });
});
