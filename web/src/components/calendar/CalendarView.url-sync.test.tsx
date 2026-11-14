/**
 * Calendar view URL race (backlog 2026-11-13, ROOT-CAUSE-calendar-server-layer):
 * with no `?view=`, the mount effects rewrite the URL from that render's
 * `searchParams` snapshot, so a Week click inside that window was overwritten
 * and the page fell back to Month. These tests click Week from a descendant's
 * mount effect — it runs in the same commit, before CalendarView's own effects.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect, useState, type JSX } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import type { CalendarViewMode } from './calendar-mobile-toolbar';
import { useCalendarViewStore } from '../../stores/calendar-view-store';

vi.mock('../../hooks/use-events', () => ({
    useEvents: () => ({ data: { data: [] }, isLoading: false, isFetching: false }),
}));

function LocationProbe(): JSX.Element {
    const { search } = useLocation();
    return <output data-testid="location-search">{search}</output>;
}

/** Clicks the toolbar's Week button the moment it mounts (a fast user). */
function ClickWeekOnMount(): null {
    useEffect(() => {
        screen.getByRole('button', { name: 'Week' }).click();
    }, []);
    return null;
}

/** Mirrors CalendarPage: the page owns `calendarView` and opens desktop in Month. */
function PageHarness(): JSX.Element {
    const [view, setView] = useState<CalendarViewMode>('month');
    return (
        <>
            <CalendarView calendarView={view} onCalendarViewChange={setView} toolbarAction={<ClickWeekOnMount />} />
            <output data-testid="page-view">{view}</output>
            <LocationProbe />
        </>
    );
}

function renderAt(route: string): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[route]}>
                <PageHarness />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('CalendarView — a view click during the mount URL sync survives', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stays on Week, and the page state agrees, when Week is clicked before the mount sync settles', () => {
        renderAt('/calendar');

        expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('page-view').textContent).toBe('week');
    });

    it('keeps both the clicked view and the date in the URL', () => {
        renderAt('/calendar');

        const params = new URLSearchParams(screen.getByTestId('location-search').textContent ?? '');
        expect(params.get('view')).toBe('week');
        expect(params.get('date')).toBe('2026-02-10');
    });
});
