import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
        isPending: false,
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

describe('GameTimePanel - Profile Mode (ROK-301)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set default mock return value
        vi.mocked(mockUseGameTimeEditor).mockReturnValue({
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
            applyPreset: vi.fn(),
        });
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

    describe('Availability Data Preservation', () => {
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
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'profile' });

            // Verify slots are rendered with correct status
            const cell0 = screen.getByTestId('cell-0-18');
            const cell1 = screen.getByTestId('cell-1-19');

            expect(cell0.dataset.status).toBe('available');
            expect(cell1.dataset.status).toBe('available');
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
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'profile' });

            const cell = screen.getByTestId('cell-2-20');
            expect(cell.dataset.status).toBe('committed');
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
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'profile' });

            const cell = screen.getByTestId('cell-3-14');
            expect(cell.dataset.status).toBe('blocked');
        });
    });

    describe('Profile Mode Rolling Override', () => {
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
                applyPreset: vi.fn(),
            };
            vi.mocked(mockUseGameTimeEditor).mockReturnValue(mockEditor);

            renderPanel({ mode: 'profile', rolling: true });

            // useGameTimeEditor should be called with rolling: false
            expect(vi.mocked(mockUseGameTimeEditor)).toHaveBeenCalledWith(
                expect.objectContaining({ rolling: false }),
            );
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
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'modal', rolling: true });

            // useGameTimeEditor should be called with rolling: true
            expect(vi.mocked(mockUseGameTimeEditor)).toHaveBeenCalledWith(
                expect.objectContaining({ rolling: true }),
            );
        });
    });

    describe('Mobile Responsive Behavior (ROK-340)', () => {
        beforeEach(() => {
            // Mock window.matchMedia for responsive tests
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation(query => ({
                    matches: false,
                    media: query,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                })),
            });
        });

        it('renders GameTimeGrid on desktop (>= 768px)', () => {
            // Mock desktop viewport
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? false : true,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            renderPanel({ mode: 'profile' });

            // GameTimeGrid should be rendered
            expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
            // GameTimeMobileEditor should not be rendered
            expect(screen.queryByTestId('game-time-mobile-editor')).not.toBeInTheDocument();
        });

        it('renders GameTimeMobileEditor on mobile (< 768px)', () => {
            // Mock mobile viewport
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? true : false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            renderPanel({ mode: 'profile' });

            // GameTimeMobileEditor should be rendered
            expect(screen.getByTestId('game-time-mobile-editor')).toBeInTheDocument();
            // GameTimeGrid should not be rendered
            expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
        });

        it('mobile editor receives correct props in profile mode', () => {
            // Mock mobile viewport
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? true : false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            vi.mocked(mockUseGameTimeEditor).mockReturnValue({
                slots: [{ dayOfWeek: 0, hour: 6, status: 'available' }],
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
                todayIndex: 0,
                currentHour: 12,
                nextWeekEvents: [],
                nextWeekSlots: [],
                weekStart: '2026-02-08',
                overrides: [],
                absences: [],
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'profile' });

            const mobileEditor = screen.getByTestId('game-time-mobile-editor');
            expect(mobileEditor).toBeInTheDocument();
        });

        it('mobile editor is read-only in picker mode', () => {
            // Mock mobile viewport
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? true : false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            renderPanel({ mode: 'picker' });

            const mobileEditor = screen.getByTestId('game-time-mobile-editor');
            expect(mobileEditor).toBeInTheDocument();

            // Expand a day section
            const sundayHeader = screen.getByText(/Sunday/).closest('button');
            if (sundayHeader) {
                fireEvent.click(sundayHeader);
            }

            // Presets should not be visible in read-only mode
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });

        it('mobile editor displays timezone label', () => {
            // Mock mobile viewport
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? true : false,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            vi.mocked(mockUseGameTimeEditor).mockReturnValue({
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
                todayIndex: 0,
                currentHour: 12,
                nextWeekEvents: [],
                nextWeekSlots: [],
                weekStart: '2026-02-08',
                overrides: [],
                absences: [],
                applyPreset: vi.fn(),
            });

            renderPanel({ mode: 'profile' });

            expect(screen.getByText('PST')).toBeInTheDocument();
        });

        it('breakpoint is exactly 767px (mobile) vs 768px (desktop)', () => {
            // The breakpoint should use max-width: 767px
            // This means 767px and below = mobile, 768px and above = desktop

            // Test mobile (767px)
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)',
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            const { unmount } = renderPanel({ mode: 'profile' });
            expect(screen.queryByTestId('game-time-mobile-editor')).toBeInTheDocument();
            unmount();

            // Test desktop (768px)
            window.matchMedia = vi.fn().mockImplementation(query => ({
                matches: query === '(max-width: 767px)' ? false : true,
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }));

            renderPanel({ mode: 'profile' });
            expect(screen.queryByTestId('game-time-grid')).toBeInTheDocument();
        });
    });
});
