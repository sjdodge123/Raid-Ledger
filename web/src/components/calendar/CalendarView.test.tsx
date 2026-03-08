import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';
import { createMockEvent } from '../../test/factories';

// ─── Navigation mock ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ─── useEvents mock with configurable return ──────────────────────────────────

const mockUseEventsReturn = {
    data: { data: [] as ReturnType<typeof createMockEvent>[] },
    isLoading: false,
    isFetching: false,
};

vi.mock('../../hooks/use-events', () => ({
    useEvents: () => mockUseEventsReturn,
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false },
    },
});

const renderWithProviders = (ui: React.ReactElement, initialRoute = '/calendar') => {
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialRoute]}>
                {ui}
            </MemoryRouter>
        </QueryClientProvider>
    );
};

describe('CalendarView — part 1', () => {
    beforeEach(() => {
        localStorage.clear();
        // Reset Zustand store to default (week) after clearing localStorage
        useCalendarViewStore.setState({ viewPref: 'week' });
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('View Toggle', () => {
        it('renders week view by default', () => {
            renderWithProviders(<CalendarView />);

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
        });

        it('clicking Week button activates week view', () => {
            renderWithProviders(<CalendarView />);

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            fireEvent.click(weekBtn);

            expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
        });

        it('view toggle has proper accessibility attributes', () => {
            renderWithProviders(<CalendarView />);

            const group = screen.getByRole('group', { name: 'Calendar view' });
            expect(group).toBeInTheDocument();

            const monthBtn = screen.getByRole('button', { name: 'Month' });
            const weekBtn = screen.getByRole('button', { name: 'Week' });

            expect(monthBtn).toHaveAttribute('type', 'button');
            expect(weekBtn).toHaveAttribute('type', 'button');
        });

        it('persists view preference to localStorage', () => {
            renderWithProviders(<CalendarView />);

            const dayBtn = screen.getByRole('button', { name: 'Day' });
            fireEvent.click(dayBtn);

            expect(localStorage.getItem('raid_ledger_calendar_view')).toBe('day');
        });

        it('respects stored preference on mount', () => {
            localStorage.setItem('raid_ledger_calendar_view', 'month');
            useCalendarViewStore.setState({ viewPref: 'month' });
            renderWithProviders(<CalendarView />);

            const monthBtn = screen.getByRole('button', { name: 'Month' });
            expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
        });

        it('respects URL param over localStorage', () => {
            localStorage.setItem('raid_ledger_calendar_view', 'day');
            renderWithProviders(<CalendarView />, '/calendar?view=month');

            const monthBtn = screen.getByRole('button', { name: 'Month' });
            expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
        });
    });

});

describe('CalendarView — part 2', () => {
    beforeEach(() => {
        localStorage.clear();
        // Reset Zustand store to default (week) after clearing localStorage
        useCalendarViewStore.setState({ viewPref: 'week' });
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Empty State', () => {
        it('shows correct empty text for week view (default)', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByText('No events this week')).toBeInTheDocument();
        });

        it('shows correct empty text for month view', () => {
            renderWithProviders(<CalendarView />);

            const monthBtn = screen.getByRole('button', { name: 'Month' });
            fireEvent.click(monthBtn);

            expect(screen.getByText('No events this month')).toBeInTheDocument();
        });
    });

    describe('Navigation', () => {
        it('Today button exists', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
        });

        it('previous button has correct aria-label for week view (default)', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
        });

        it('previous button has correct aria-label for month view', () => {
            renderWithProviders(<CalendarView />);

            fireEvent.click(screen.getByRole('button', { name: 'Month' }));

            expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
        });
    });

    describe('Schedule view (calendarView prop)', () => {
        it('renders ScheduleView (empty state) when calendarView="schedule"', () => {
            renderWithProviders(<CalendarView calendarView="schedule" />);
            // ScheduleView empty state text
            expect(screen.getByText('No events scheduled')).toBeInTheDocument();
        });

        it('does not render the week/month/day toolbar when calendarView="schedule"', () => {
            renderWithProviders(<CalendarView calendarView="schedule" />);
            // The view toggle group is only present in the non-schedule branch
            expect(screen.queryByRole('group', { name: 'Calendar view' })).toBeNull();
        });

        it('does not render nav toolbar buttons when calendarView="schedule"', () => {
            renderWithProviders(<CalendarView calendarView="schedule" />);
            expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
        });

        it('renders react-big-calendar when calendarView is not "schedule"', () => {
            renderWithProviders(<CalendarView calendarView="month" />);
            // The view toggle should be present for non-schedule views
            expect(screen.getByRole('group', { name: 'Calendar view' })).toBeInTheDocument();
        });

    });

});

describe('CalendarView — schedule event navigation (ROK-691)', () => {
    let originalInnerWidth: number;

    beforeEach(() => {
        localStorage.clear();
        mockNavigate.mockClear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
        originalInnerWidth = window.innerWidth;
    });

    afterEach(() => {
        vi.useRealTimers();
        mockUseEventsReturn.data = { data: [] };
        Object.defineProperty(window, 'innerWidth', {
            value: originalInnerWidth,
            writable: true,
            configurable: true,
        });
    });

    it('navigates to event detail when tapping event in schedule view with stale month viewPref', () => {
        // Simulate stale month viewPref from a prior desktop session
        useCalendarViewStore.setState({ viewPref: 'month' });

        // Simulate mobile viewport
        Object.defineProperty(window, 'innerWidth', {
            value: 375,
            writable: true,
            configurable: true,
        });

        // Provide an event so the schedule view renders a tappable card
        const mockEvent = createMockEvent({
            id: 42,
            title: 'Raid Night',
            startTime: '2026-02-10T20:00:00Z',
            endTime: '2026-02-10T23:00:00Z',
        });
        mockUseEventsReturn.data = { data: [mockEvent] };

        renderWithProviders(
            <CalendarView calendarView="schedule" />,
            '/calendar',
        );

        // The schedule view should render the event card as a button
        const eventButton = screen.getByRole('button', { name: /Raid Night/i });
        fireEvent.click(eventButton);

        // Should navigate to the event detail page, not drill down to day view
        expect(mockNavigate).toHaveBeenCalledWith(
            '/events/42',
            expect.objectContaining({
                state: expect.objectContaining({ fromCalendar: true }),
            }),
        );
    });
});
