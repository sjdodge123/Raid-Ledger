import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { GameTimeWidget } from './GameTimeWidget';

// Mock useGameTimeEditor to return controlled data
const mockEditorReturn = vi.fn();
vi.mock('../../../hooks/use-game-time-editor', () => ({
    useGameTimeEditor: () => mockEditorReturn(),
}));

// Mock useCancelSignup (used by EventBlockPopover)
vi.mock('../../../hooks/use-signups', () => ({
    useCancelSignup: () => ({
        mutateAsync: vi.fn(),
        isPending: false,
    }),
}));

function makeEditorData(overrides: Partial<ReturnType<typeof mockEditorReturn>> = {}) {
    return {
        slots: [],
        events: [],
        nextWeekEvents: undefined,
        nextWeekSlots: undefined,
        isLoading: false,
        weekStart: '2026-02-08',
        isDirty: false,
        handleChange: vi.fn(),
        save: vi.fn(),
        clear: vi.fn(),
        discard: vi.fn(),
        isSaving: false,
        tzLabel: 'EST',
        todayIndex: 1, // Monday
        currentHour: 16.5,
        overrides: [],
        absences: [],
        ...overrides,
    };
}

function renderWidget(props: {
    eventStart: string;
    eventEnd: string;
    eventTitle?: string;
    attendees?: Array<{ id: number; username: string; avatar: string | null }>;
    attendeeCount?: number;
}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <MemoryRouter>
            <QueryClientProvider client={queryClient}>
                <GameTimeWidget
                    eventStartTime={props.eventStart}
                    eventEndTime={props.eventEnd}
                    eventTitle={props.eventTitle}
                    attendees={props.attendees}
                    attendeeCount={props.attendeeCount}
                />
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

describe('GameTimeWidget', () => {
    it('shows overlap message when template matches event hours', () => {
        // 2026-02-09 is Monday → JS getDay()=1 → game-time dayOfWeek=0
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [
                { dayOfWeek: 0, hour: 19, status: 'available' },
                { dayOfWeek: 0, hour: 20, status: 'available' },
            ],
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        expect(screen.getByText('Inside Game Time')).toBeInTheDocument();
    });

    it('shows no-overlap message when template does not match', () => {
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [
                { dayOfWeek: 5, hour: 10, status: 'available' },
            ],
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        expect(screen.getByText('Outside Game Time')).toBeInTheDocument();
    });

    it('click opens read-only modal with GameTimeGrid', () => {
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        expect(screen.getByText('My Game Time')).toBeInTheDocument();
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
    });

    it('modal shows preview block overlay for the current event', () => {
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        const previewBlock = screen.getByTestId('preview-block-1-19');
        expect(previewBlock).toBeInTheDocument();
        expect(previewBlock.style.border).toContain('dashed');
    });

    it('modal shows event title in the detail card below the grid', () => {
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        }));

        renderWidget({
            eventStart: '2026-02-09T19:00:00',
            eventEnd: '2026-02-09T22:00:00',
            eventTitle: 'Raid Night',
        });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        // Preview block is border-only (no content inside)
        const previewBlock = screen.getByTestId('preview-block-1-19');
        expect(previewBlock).toBeInTheDocument();

        // Event title appears in the detail card below the grid (and may also appear in preview block)
        const raidNights = screen.getAllByText('Raid Night');
        expect(raidNights.length).toBeGreaterThanOrEqual(1);
    });

    it('modal is read-only (cells are not paintable)', () => {
        const handleChange = vi.fn();
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [],
            handleChange,
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        // Try to paint a cell within the visible hour range — should NOT trigger onChange since grid is readOnly
        // Event is 19:00-22:00 so smart range is ~[14, 24]. Use hour 18 which is visible.
        fireEvent.pointerDown(screen.getByTestId('cell-2-18'));
        fireEvent.pointerUp(screen.getByTestId('cell-2-18'));

        expect(handleChange).not.toHaveBeenCalled();
    });

    it('modal has "Edit my game time" link to profile', () => {
        mockEditorReturn.mockReturnValue(makeEditorData({
            slots: [{ dayOfWeek: 0, hour: 19, status: 'available' }],
        }));

        renderWidget({ eventStart: '2026-02-09T19:00:00', eventEnd: '2026-02-09T22:00:00' });

        fireEvent.click(screen.getByTestId('game-time-widget'));

        const link = screen.getByText(/Edit my game time/);
        expect(link).toBeInTheDocument();
        expect(link.closest('a')).toHaveAttribute('href', '/profile/gaming');
    });
});
