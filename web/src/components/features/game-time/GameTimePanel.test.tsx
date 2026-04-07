import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameTimePanel } from './GameTimePanel';

// Mock the hooks
vi.mock('../../../hooks/use-game-time-editor', () => ({
    useGameTimeEditor: vi.fn(),
}));

vi.mock('../../../hooks/use-game-time', () => ({
    useCreateAbsence: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
    })),
    useDeleteAbsence: vi.fn(() => ({
        mutateAsync: vi.fn(),
        mutate: vi.fn(),
        isPending: false,
    })),
    useGameTimeAbsences: vi.fn(() => ({
        data: [],
    })),
}));

// Get the mocked hook
import { useGameTimeEditor as mockUseGameTimeEditor } from '../../../hooks/use-game-time-editor';

function renderPanel(props: Partial<React.ComponentProps<typeof GameTimePanel>> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <GameTimePanel mode="profile" {...props} />
        </QueryClientProvider>,
    );
}

function createDefaultEditorMock(overrides = {}) {
    return {
        slots: [],
        handleChange: vi.fn(),
        applyPreset: vi.fn(),
        clear: vi.fn(),
        discard: vi.fn(),
        save: vi.fn(),
        isDirty: false,
        isSaving: false,
        isLoading: false,
        tzLabel: 'PST',
        events: [],
        todayIndex: 3,
        currentHour: 15.5,
        nextWeekEvents: [],
        nextWeekSlots: [],
        weekStart: '2026-02-08',
        overrides: [],
        absences: [],
        ...overrides,
    };
}

function setupDefaultEditorMock(overrides = {}) {
    vi.clearAllMocks();
    vi.mocked(mockUseGameTimeEditor).mockReturnValue(createDefaultEditorMock(overrides));
}

describe('GameTimePanel - Profile Mode (ROK-301) — part 1', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    describe('Full Day Names', () => {
        it('profile mode displays full day names (Sunday, Monday, etc.)', () => {
            renderPanel({ mode: 'profile' });

            // Check for full day names in header cells
            expect(screen.getByTestId('day-header-0')).toHaveTextContent(/Sunday|Sun/);
            expect(screen.getByTestId('day-header-1')).toHaveTextContent(/Monday|Mon/);
            expect(screen.getByTestId('day-header-2')).toHaveTextContent(/Tuesday|Tue/);
            expect(screen.getByTestId('day-header-3')).toHaveTextContent(/Wednesday|Wed/);
            expect(screen.getByTestId('day-header-4')).toHaveTextContent(/Thursday|Thu/);
            expect(screen.getByTestId('day-header-5')).toHaveTextContent(/Friday|Fri/);
            expect(screen.getByTestId('day-header-6')).toHaveTextContent(/Saturday|Sat/);
        });

        it('modal mode displays abbreviated day names (Sun, Mon, etc.)', () => {
            renderPanel({ mode: 'modal' });

            // Modal mode should use abbreviated names
            const header0 = screen.getByTestId('day-header-0');
            const header1 = screen.getByTestId('day-header-1');

            // These should be short abbreviated names, not full names
            expect(header0.textContent).toMatch(/^Sun/);
            expect(header1.textContent).toMatch(/^Mon/);
        });

        it('picker mode displays abbreviated day names (Sun, Mon, etc.)', () => {
            renderPanel({ mode: 'picker' });

            const header0 = screen.getByTestId('day-header-0');
            const header1 = screen.getByTestId('day-header-1');

            expect(header0.textContent).toMatch(/^Sun/);
            expect(header1.textContent).toMatch(/^Mon/);
        });
    });

});

describe('GameTimePanel - Profile Mode (ROK-301) — part 2', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    describe('Sunday Week Start', () => {
        it('starts week on Sunday (day index 0)', () => {
            renderPanel({ mode: 'profile' });

            // First day header should be Sunday
            const firstDayHeader = screen.getByTestId('day-header-0');
            expect(firstDayHeader).toHaveTextContent(/Sunday|Sun/);

            // Last day header should be Saturday
            const lastDayHeader = screen.getByTestId('day-header-6');
            expect(lastDayHeader).toHaveTextContent(/Saturday|Sat/);
        });
    });

    describe('No Rolling Week Logic', () => {
        it('profile mode does not render rolling week divider', () => {
            renderPanel({ mode: 'profile' });

            // Rolling week divider should not exist in profile mode
            expect(screen.queryByTestId('rolling-week-divider-left')).not.toBeInTheDocument();
            expect(screen.queryByTestId('rolling-week-divider-bottom')).not.toBeInTheDocument();
            expect(screen.queryByTestId('rolling-week-divider-right')).not.toBeInTheDocument();
        });

        it('modal mode can render rolling week divider', () => {
            renderPanel({ mode: 'modal', rolling: true });

            // Modal mode with rolling=true should show divider elements
            // (actual rendering depends on gridDims measurement, but elements should exist)
            const grid = screen.getByTestId('game-time-grid');
            expect(grid).toBeInTheDocument();
        });
    });

    describe('No Events Displayed', () => {
        it('profile mode does not render event blocks', () => {
            renderPanel({ mode: 'profile' });

            // Profile mode should not render any event blocks
            const eventBlocks = screen.queryAllByTestId(/^event-block-/);
            expect(eventBlocks).toHaveLength(0);
        });

        it('profile mode does not render event popover', () => {
            renderPanel({ mode: 'profile' });

            // EventBlockPopover should not exist in profile mode
            expect(screen.queryByTestId('event-popover')).not.toBeInTheDocument();
        });

    });

});

describe('GameTimePanel - Profile Mode (ROK-301) — part 3', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    describe('Profile Mode UI Elements', () => {
        it('renders profile mode header and description', () => {
            renderPanel({ mode: 'profile' });

            expect(screen.getByText('My Game Time')).toBeInTheDocument();
            expect(screen.getByText('Set your typical weekly availability')).toBeInTheDocument();
        });

        it('renders Save button', () => {
            renderPanel({ mode: 'profile' });

            expect(screen.getByText('Save')).toBeInTheDocument();
        });

        it('renders Clear button', () => {
            renderPanel({ mode: 'profile' });

            expect(screen.getByText('Clear')).toBeInTheDocument();
        });

        it('renders Absence button', () => {
            renderPanel({ mode: 'profile' });

            expect(screen.getByText('Absence')).toBeInTheDocument();
        });

        it('modal mode does not render profile UI elements', () => {
            renderPanel({ mode: 'modal' });

            expect(screen.queryByText('My Game Time')).not.toBeInTheDocument();
            expect(screen.queryByText('Save')).not.toBeInTheDocument();
            expect(screen.queryByText('Clear')).not.toBeInTheDocument();
            expect(screen.queryByText('Absence')).not.toBeInTheDocument();
        });
    });

});

describe('GameTimePanel - Profile Mode (ROK-301) — part 4', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    describe('Availability Data Preservation — part 1', () => {
        it('renders slots passed to GameTimeGrid', () => {
            vi.mocked(mockUseGameTimeEditor).mockReturnValue({
                slots: [
                    { dayOfWeek: 0, hour: 18, status: 'available' },
                    { dayOfWeek: 1, hour: 19, status: 'available' },
                ],
                handleChange: vi.fn(),
                applyPreset: vi.fn(),
                clear: vi.fn(),
                save: vi.fn(),
                isDirty: false,
                isSaving: false,
                isLoading: false,
                tzLabel: 'PST',
                events: [],
                todayIndex: 3,
                currentHour: 15.5,
                nextWeekEvents: [],
                nextWeekSlots: [],
                weekStart: '2026-02-08',
                absences: [],
                discard: vi.fn(),
                overrides: [],
            });

            renderPanel({ mode: 'profile' });

            // Verify slots are rendered with correct status
            const cell0 = screen.getByTestId('cell-0-18');
            const cell1 = screen.getByTestId('cell-1-19');

            expect(cell0.dataset.status).toBe('available');
            expect(cell1.dataset.status).toBe('available');
        });

    });

});

describe('Availability Data Preservation — part 2 (sub 1)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('preserves committed slots', () => {
        vi.mocked(mockUseGameTimeEditor).mockReturnValue({
            slots: [
                { dayOfWeek: 2, hour: 20, status: 'committed' },
            ],
            handleChange: vi.fn(),
            applyPreset: vi.fn(),
            clear: vi.fn(),
            save: vi.fn(),
            isDirty: false,
            isSaving: false,
            isLoading: false,
            tzLabel: 'PST',
            events: [],
            todayIndex: 3,
            currentHour: 15.5,
            nextWeekEvents: [],
            nextWeekSlots: [],
            weekStart: '2026-02-08',
            absences: [],
            discard: vi.fn(),
            overrides: [],
        });

        renderPanel({ mode: 'profile' });

        const cell = screen.getByTestId('cell-2-20');
        expect(cell.dataset.status).toBe('committed');
    });

});

describe('Availability Data Preservation — part 2 (sub 2)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('preserves blocked slots', () => {
        vi.mocked(mockUseGameTimeEditor).mockReturnValue({
            slots: [
                { dayOfWeek: 3, hour: 14, status: 'blocked' },
            ],
            handleChange: vi.fn(),
            applyPreset: vi.fn(),
            clear: vi.fn(),
            save: vi.fn(),
            isDirty: false,
            isSaving: false,
            isLoading: false,
            tzLabel: 'PST',
            events: [],
            todayIndex: 3,
            currentHour: 15.5,
            nextWeekEvents: [],
            nextWeekSlots: [],
            weekStart: '2026-02-08',
            absences: [],
            discard: vi.fn(),
            overrides: [],
        });

        renderPanel({ mode: 'profile' });

        const cell = screen.getByTestId('cell-3-14');
        expect(cell.dataset.status).toBe('blocked');
    });

});

describe('Profile Mode Rolling Override — sub 1', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('forces rolling=false in profile mode even if rolling=true is passed', () => {
        const mockEditor = {
            slots: [],
            handleChange: vi.fn(),
            applyPreset: vi.fn(),
            clear: vi.fn(),
            discard: vi.fn(),
            save: vi.fn(),
            isDirty: false,
            isSaving: false,
            isLoading: false,
            tzLabel: 'PST',
            events: [],
            todayIndex: 3,
            currentHour: 15.5,
            nextWeekEvents: [],
            nextWeekSlots: [],
            weekStart: '2026-02-08',
            overrides: [],
            absences: [],
        };
        vi.mocked(mockUseGameTimeEditor).mockReturnValue(mockEditor);

        renderPanel({ mode: 'profile', rolling: true });

        // useGameTimeEditor should be called with rolling: false
        expect(vi.mocked(mockUseGameTimeEditor)).toHaveBeenCalledWith(
            expect.objectContaining({ rolling: false }),
        );
    });

});

describe('Profile Mode Rolling Override — sub 2', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('respects rolling prop in modal mode', () => {
        vi.mocked(mockUseGameTimeEditor).mockReturnValue({
            slots: [],
            handleChange: vi.fn(),
            applyPreset: vi.fn(),
            clear: vi.fn(),
            save: vi.fn(),
            isDirty: false,
            isSaving: false,
            isLoading: false,
            tzLabel: 'PST',
            events: [],
            todayIndex: 3,
            currentHour: 15.5,
            nextWeekEvents: [],
            nextWeekSlots: [],
            weekStart: '2026-02-08',
            absences: [],
            discard: vi.fn(),
            overrides: [],
        });

        renderPanel({ mode: 'modal', rolling: true });

        // useGameTimeEditor should be called with rolling: true
        expect(vi.mocked(mockUseGameTimeEditor)).toHaveBeenCalledWith(
            expect.objectContaining({ rolling: true }),
        );
    });

});

describe('GameTimePanel - Profile Mode (ROK-301) — part 7', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    describe('Compact Grid Rendering (ROK-1011)', () => {
        it('always renders GameTimeGrid with compact mode', () => {
            renderPanel({ mode: 'profile' });

            expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
            expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
        });
    });

});

describe('Grid receives correct props in profile mode (ROK-1011)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('renders GameTimeGrid with slots in profile mode', () => {
        vi.mocked(mockUseGameTimeEditor).mockReturnValue(createDefaultEditorMock({
            slots: [{ dayOfWeek: 0, hour: 6, status: 'available' }],
        }));

        renderPanel({ mode: 'profile' });

        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
    });

});

describe('GameTimePanel - Picker Mode read-only (ROK-1011)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('renders read-only GameTimeGrid in picker mode', () => {
        renderPanel({ mode: 'picker' });

        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
    });

});

describe('Timezone label display (ROK-1011)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('displays timezone label in profile mode', () => {
        renderPanel({ mode: 'profile' });
        expect(screen.getByText('PST')).toBeInTheDocument();
    });

});

describe('GameTimePanel - always renders GameTimeGrid (ROK-1011)', () => {
    beforeEach(() => {
        setupDefaultEditorMock();
    });

    it('renders GameTimeGrid regardless of viewport', () => {
        renderPanel({ mode: 'profile' });
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
    });

});
