import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';
import { createMockEvent } from '../../test/factories';
import { useCalendarHubFilterStore, NO_HUB, type HubKey } from '../../pages/calendar/use-calendar-hub-filter';

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

// ROK-1662: a page loaded phone-width (Schedule default) and widened past 1024px
// had NO filter at all — the schedule branch dropped both toolbar slots.
describe('CalendarView — schedule view keeps the Filters slots (ROK-1662)', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
    });

    it('still renders the Filters funnel and the inline panel in schedule view', () => {
        renderWithProviders(
            <CalendarView calendarView="schedule"
                toolbarAction={<button type="button" data-testid="funnel-slot">Filters</button>}
                belowToolbar={<div data-testid="panel-slot" />} />,
        );
        expect(screen.getByTestId('funnel-slot')).toBeInTheDocument();
        expect(screen.getByTestId('panel-slot')).toBeInTheDocument();
    });

    it('schedule view puts the funnel above the panel, and both above the schedule list', () => {
        renderWithProviders(
            <CalendarView calendarView="schedule"
                toolbarAction={<button type="button" data-testid="funnel-slot">Filters</button>}
                belowToolbar={<div data-testid="panel-slot" />} />,
        );
        const funnel = screen.getByTestId('funnel-slot');
        const panel = screen.getByTestId('panel-slot');
        const list = screen.getByText('No events scheduled');
        expect(funnel.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe('CalendarView — hub-filtered empty state (ROK-1893)', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
    });
    afterEach(() => {
        useCalendarHubFilterStore.getState().showAll();
    });

    it('shows a filter-aware empty line + "Show all hubs" while the hub filter hides events (ROK-1893)', () => {
        useCalendarHubFilterStore.setState({ hidden: new Set<HubKey>([NO_HUB]) });
        renderWithProviders(<CalendarView />);
        expect(screen.getByText('No events match your filters')).toBeInTheDocument();
        expect(screen.queryByText('No events this week')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show all hubs' }));
        expect(useCalendarHubFilterStore.getState().hidden.size).toBe(0);
        expect(screen.getByText('No events this week')).toBeInTheDocument();
    });
});

describe('CalendarView — Week card accessible name carries the hub (ROK-1893 P4 verify)', () => {
    const LABEL = String.raw`\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M`;
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
        mockUseEventsReturn.data = { data: [] };
    });

    // rbc's card is a role=button div whose name comes from its content and whose `title`
    // ("<time>: <tooltip>") is what the verify lane read; both must carry the hub.
    it('a hub-tagged card reads "<time>: <title> · <hub>"; an untagged one stays "<time>: <title>"', () => {
        mockUseEventsReturn.data = {
            data: [
                createMockEvent({ id: 34, title: 'Hub calendar night #34', startTime: '2026-02-10T14:00:00Z', endTime: '2026-02-10T17:00:00Z', hub: { id: 7, name: 'Seed Crew', kind: 'game_community' } }),
                createMockEvent({ id: 35, title: 'Plain night', startTime: '2026-02-11T14:00:00Z', endTime: '2026-02-11T17:00:00Z', hub: null }),
            ],
        };
        renderWithProviders(<CalendarView />, '/calendar?view=week');
        const tagged = screen.getByRole('button', { name: /Hub calendar night #34.*· Seed Crew/, description: new RegExp(`^${LABEL}: Hub calendar night #34 · Seed Crew$`) });
        expect(tagged).toHaveAttribute('title', expect.stringMatching(/: Hub calendar night #34 · Seed Crew$/));
        expect(screen.getByRole('button', { name: /Plain night/, description: new RegExp(`^${LABEL}: Plain night$`) })).toBeInTheDocument();
    });
});
