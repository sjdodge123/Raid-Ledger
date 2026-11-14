/**
 * The page owns `calendarView` (the grid follows it, not the URL), so a real
 * navigation that changes `?view=` while the page stays mounted — Back/Forward,
 * a link to `/calendar?view=day` — must be reconciled into page state. The
 * grid's own replace-writes (URL sync) must NOT be, or a view click during the
 * mount sync would bounce back (the race the url-sync fix closed).
 */
import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import type { CalendarViewMode } from '../components/calendar/calendar-mobile-toolbar';
import { renderPage } from './calendar-page.test-helpers';

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({ isAuthenticated: false, user: null }),
    getAuthToken: () => null,
}));
vi.mock('../hooks/use-game-time', () => ({ useGameTime: () => ({ data: null }) }));
vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [], isLoading: false, error: null }),
}));
vi.mock('../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../components/calendar/calendar-styles.css', () => ({}));
vi.mock('../components/calendar/calendar-mobile-toolbar', () => ({ CalendarMobileToolbar: () => null }));
vi.mock('../components/calendar/calendar-mobile-nav', () => ({ CalendarMobileNav: () => null }));
vi.mock('./calendar/CalendarFilterEntry', () => ({ CalendarFilterEntry: () => null, CalendarFilterTrigger: () => null }));

let navigateRef: NavigateFunction | null = null;
let echoOnMount: CalendarViewMode | null = null;

/** Stands in for the grid: shows the controlled view, exposes navigate, and can echo a stale URL write. */
function GridStub({ calendarView, onCalendarViewChange }: {
    calendarView: CalendarViewMode; onCalendarViewChange: (v: CalendarViewMode) => void;
}): JSX.Element {
    const navigate = useNavigate();
    useEffect(() => { navigateRef = navigate; }, [navigate]);
    useEffect(() => {
        if (!echoOnMount) return;
        onCalendarViewChange(echoOnMount);
        navigate('/calendar?view=month', { replace: true });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="calendar-view" data-view={calendarView} />;
}

vi.mock('../components/calendar', () => ({ CalendarView: GridStub, MiniCalendar: () => null }));

import { CalendarPage } from './calendar-page';

function gridView(): string | null {
    return screen.getByTestId('calendar-view').getAttribute('data-view');
}

function go(to: string): void {
    const navigate = navigateRef;
    if (!navigate) throw new Error('navigate not captured');
    act(() => { void navigate(to); });
}

describe('CalendarPage — external ?view= navigation while mounted', () => {
    it('switches the grid from Week to Month when the location changes to ?view=month', () => {
        echoOnMount = null;
        renderPage(CalendarPage, ['/calendar?view=week']);
        expect(gridView()).toBe('week');

        go('/calendar?view=month');

        expect(gridView()).toBe('month');
    });

    it('follows a link to ?view=day, and a link with no view opens Month like a fresh load', () => {
        echoOnMount = null;
        renderPage(CalendarPage, ['/calendar?view=week']);

        go('/calendar?view=day');
        expect(gridView()).toBe('day');

        go('/calendar');
        expect(gridView()).toBe('month');
    });

    it('ignores the grid\'s own replace-write of a stale view (a Week click during mount sync survives)', () => {
        echoOnMount = 'week';
        renderPage(CalendarPage, ['/calendar']);

        expect(gridView()).toBe('week');
    });
});
