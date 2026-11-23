/**
 * ROK-2303: phones now honour `?view=day|month`, so Schedule must never leave a
 * stale `view` in the URL (a reload or Back would open the wrong view), and
 * leaving Schedule must always write the view it switches to, even when the
 * saved preference already matches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect, useState, type JSX } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarView } from './CalendarView';
import type { CalendarViewMode } from './calendar-mobile-toolbar';
import { useCalendarViewStore } from '../../stores/calendar-view-store';

vi.mock('../../hooks/use-events', () => ({
    useEvents: () => ({ data: { data: [] }, isLoading: false, isFetching: false }),
}));

let setPageView: ((v: CalendarViewMode) => void) | null = null;

function Harness({ initial }: { initial: CalendarViewMode }): JSX.Element {
    const [view, setView] = useState<CalendarViewMode>(initial);
    useEffect(() => { setPageView = setView; }, []);
    const { search } = useLocation();
    return (
        <>
            <CalendarView calendarView={view} onCalendarViewChange={setView} />
            <output data-testid="location-search">{search}</output>
        </>
    );
}

function renderAt(route: string, initial: CalendarViewMode): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[route]}><Harness initial={initial} /></MemoryRouter>
        </QueryClientProvider>,
    );
}

function urlView(): string | null {
    return new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('view');
}

function switchTo(view: CalendarViewMode): void {
    const set = setPageView;
    if (!set) throw new Error('page setter not captured');
    act(() => { set(view); });
}

describe('CalendarView — the URL while Schedule is shown', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'day' });
    });

    it('drops a stale ?view= when the page shows Schedule', () => {
        renderAt('/calendar?view=week&date=2026-03-10', 'schedule');

        expect(urlView()).toBeNull();
    });

    it('writes ?view=day on Schedule → Day even when the saved pref is already Day, and drops it on → Schedule', () => {
        renderAt('/calendar?date=2026-03-10', 'schedule');

        switchTo('day');
        expect(urlView()).toBe('day');

        switchTo('schedule');
        expect(urlView()).toBeNull();

        switchTo('month');
        expect(urlView()).toBe('month');
    });
});
