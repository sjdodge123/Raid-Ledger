import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';

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
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('View Toggle', () => {
        it('renders month view by default', () => {
            renderWithProviders(<CalendarView />);

            const monthBtn = screen.getByRole('button', { name: 'Month' });
            expect(monthBtn).toHaveAttribute('aria-pressed', 'true');
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

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            fireEvent.click(weekBtn);

            expect(localStorage.getItem('calendar-view')).toBe('week');
        });

        it('respects localStorage preference on mount', () => {
            localStorage.setItem('calendar-view', 'week');
            renderWithProviders(<CalendarView />);

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
        });

        it('respects URL param over localStorage', () => {
            localStorage.setItem('calendar-view', 'month');
            renderWithProviders(<CalendarView />, '/calendar?view=week');

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            expect(weekBtn).toHaveAttribute('aria-pressed', 'true');
        });
    });

    describe('Empty State', () => {
        it('shows correct empty text for month view', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByText('No events this month')).toBeInTheDocument();
        });

        it('shows correct empty text for week view', () => {
            renderWithProviders(<CalendarView />);

            const weekBtn = screen.getByRole('button', { name: 'Week' });
            fireEvent.click(weekBtn);

            expect(screen.getByText('No events this week')).toBeInTheDocument();
        });
    });

    describe('Navigation', () => {
        it('Today button exists', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
        });

        it('previous button has correct aria-label for month view', () => {
            renderWithProviders(<CalendarView />);
            expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
        });

        it('previous button has correct aria-label for week view', () => {
            renderWithProviders(<CalendarView />);

            fireEvent.click(screen.getByRole('button', { name: 'Week' }));

            expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
        });
    });
});
