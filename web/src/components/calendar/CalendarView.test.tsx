import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import { useCalendarViewStore } from '../../stores/calendar-view-store';

// Mock useEvents hook
vi.mock('../../hooks/use-events', () => ({
    useEvents: () => ({
        data: { data: [] },
        isLoading: false,
    }),
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

describe('CalendarView', () => {
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
});
