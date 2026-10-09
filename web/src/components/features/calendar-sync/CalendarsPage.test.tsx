/**
 * Profile → Calendars (ROK-1594) — every page state against MSW: switch off,
 * not configured, available (Connect → consent URL), connected (Manage →
 * Disconnect → DELETE → overview refetched) on both shells, a failed
 * DELETE, `?connected=google`, and `?error=<code>` for every code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDARS_OVERVIEW_URL, CALENDAR_CONNECTION_URL, GOOGLE_CONSENT_URL_FIXTURE,
    calendarsOverviewVariants, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CalendarsPage } from './CalendarsPage';
import {
    CALENDARS_COPY as C, OAUTH_ERROR_COPY, OAUTH_ERROR_FALLBACK, type CalendarOAuthErrorCode,
} from './calendar-sync.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PATH = '/profile/gaming/calendars';
const realMatchMedia = window.matchMedia;

function setDesktop(desktop: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true, writable: true,
        value: (query: string) => ({
            matches: query === DESKTOP_MQ ? desktop : false, media: query, onchange: null,
            addEventListener: () => {}, removeEventListener: () => {},
            addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        }),
    });
}

function LocationProbe() {
    const loc = useLocation();
    return <span data-testid="location">{loc.pathname + loc.search}</span>;
}

function renderPage(url = PATH) {
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path={PATH} element={<><CalendarsPage /><LocationProbe /></>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

function useOverview(overview: CalendarsOverview) {
    server.use(...userCalendarHandlers(overview));
}

beforeEach(() => {
    localStorage.setItem('raid_ledger_token', 'test-token');
    setDesktop(true);
    vi.mocked(toast.success).mockClear();
});

afterEach(() => {
    localStorage.removeItem('raid_ledger_token');
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('CalendarsPage — switch off / not configured / available', () => {
    it('switch off: shows the unavailable notice and no Connect', async () => {
        useOverview(calendarsOverviewVariants.disabled);
        renderPage();
        expect(await screen.findByTestId('calendars-unavailable')).toHaveTextContent(C.unavailable);
        expect(screen.queryByTestId('calendar-connect-google')).toBeNull();
    });

    it('not configured: Google row stays, Connect disabled, admin hint', async () => {
        useOverview(calendarsOverviewVariants.notConfigured);
        renderPage();
        expect(await screen.findByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.notConfigured);
        expect(screen.getByTestId('calendar-connect-google')).toBeDisabled();
    });

    it('available: lede + Google row; Connect GETs start and assigns the consent URL', async () => {
        const realLocation = window.location;
        const assign = vi.fn();
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
        try {
            useOverview(calendarsOverviewVariants.available);
            renderPage();
            expect(await screen.findByText(C.lede)).toBeInTheDocument();
            expect(screen.getByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.hint);
            fireEvent.click(screen.getByTestId('calendar-connect-google'));
            await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
        }
    });
});

/** Overview is connected until a DELETE lands, then empty — records the deleted ids. */
function useStatefulDisconnect(status = 202): number[] {
    const deleted: number[] = [];
    server.use(
        http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(
            deleted.length ? calendarsOverviewVariants.available : calendarsOverviewVariants.connected,
        )),
        http.delete(CALENDAR_CONNECTION_URL, ({ params }) => {
            if (status !== 202) return HttpResponse.json({ message: 'boom' }, { status });
            deleted.push(Number(params.id));
            return new HttpResponse(null, { status: 202 });
        }),
    );
    return deleted;
}

/** Swap `window.location` for one whose `assign` is a spy; returns the spy and a restore. */
function spyOnAssign(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
    const realLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
    return {
        assign,
        restore: () => Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation }),
    };
}

describe('CalendarsPage — connected keeps the Google row (Q15)', () => {
    it('connected: the card AND the Google row render; the row offers another account', async () => {
        useOverview(calendarsOverviewVariants.connected);
        renderPage();
        expect(await screen.findByTestId('calendar-connection-status')).toHaveTextContent('Connected · raider@example.com');
        expect(screen.getByText(C.connectedHeading)).toBeInTheDocument();
        expect(screen.getByText(C.addHeading)).toBeInTheDocument();
        expect(screen.getByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.hintAnother);
        expect(screen.getByTestId('calendar-connect-google')).toBeEnabled();
    });

    it('connect another: Connect from the connected state GETs start and assigns the consent URL', async () => {
        const { assign, restore } = spyOnAssign();
        try {
            useOverview(calendarsOverviewVariants.connected);
            renderPage();
            await screen.findByTestId('calendar-connection-card');
            fireEvent.click(screen.getByTestId('calendar-connect-google'));
            await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
        } finally {
            restore();
        }
    });
});

describe('CalendarsPage — connected card + Disconnect', () => {
    it('desktop: card → Manage menu → Disconnect → confirm → DELETE → overview refetched', async () => {
        const deleted = useStatefulDisconnect();
        renderPage();
        expect(await screen.findByTestId('calendar-connection-status')).toHaveTextContent('Connected · raider@example.com');
        fireEvent.click(screen.getByTestId('calendar-manage'));
        const menu = screen.getByTestId('calendar-manage-menu');
        expect(menu).toBeVisible();
        fireEvent.click(within(menu).getByRole('menuitem', { name: C.disconnect }));
        fireEvent.click(await screen.findByTestId('calendar-disconnect-confirm'));
        await waitFor(() => expect(deleted).toEqual([7]));
        await waitFor(() => expect(screen.queryByTestId('calendar-connection-card')).toBeNull());
        expect(screen.getByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.hint);
        expect(toast.success).toHaveBeenCalledWith(C.toastDisconnected);
    });

    it('phone: Manage opens a sheet; Disconnect → confirm sheet → DELETE', async () => {
        setDesktop(false);
        const deleted = useStatefulDisconnect();
        renderPage();
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        const sheet = await screen.findByTestId('calendar-manage-sheet');
        fireEvent.click(within(sheet).getByRole('button', { name: C.disconnect }));
        fireEvent.click(await screen.findByTestId('calendar-disconnect-confirm'));
        await waitFor(() => expect(deleted).toEqual([7]));
    });

    it('a failed DELETE shows inline in the confirm, and no success toast', async () => {
        useStatefulDisconnect(500);
        renderPage();
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(within(screen.getByTestId('calendar-manage-menu')).getByRole('menuitem', { name: C.disconnect }));
        fireEvent.click(await screen.findByTestId('calendar-disconnect-confirm'));
        expect(await within(screen.getByTestId('calendar-disconnect-dialog')).findByRole('alert'))
            .toHaveTextContent(C.disconnectFailed);
        expect(toast.success).not.toHaveBeenCalled();
    });
});

describe('CalendarsPage — OAuth redirect feedback', () => {
    it('?connected=google toasts success and strips the param', async () => {
        useOverview(calendarsOverviewVariants.connected);
        renderPage(`${PATH}?connected=google`);
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(C.toastConnected, expect.anything()));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${PATH}$`)));
    });

    const codes = Object.keys(OAUTH_ERROR_COPY) as CalendarOAuthErrorCode[];
    it.each(codes)('?error=%s renders its inline banner copy and strips the param', async (code) => {
        useOverview(calendarsOverviewVariants.available);
        renderPage(`${PATH}?error=${code}`);
        const banner = await screen.findByTestId('calendar-oauth-error');
        expect(banner).toHaveTextContent(OAUTH_ERROR_COPY[code]);
        expect(banner).toHaveAttribute('data-error-code', code);
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${PATH}$`)));
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('an unknown ?error code falls back to generic copy; Dismiss hides the banner', async () => {
        useOverview(calendarsOverviewVariants.available);
        renderPage(`${PATH}?error=mystery`);
        expect(await screen.findByTestId('calendar-oauth-error')).toHaveTextContent(OAUTH_ERROR_FALLBACK);
        fireEvent.click(screen.getByRole('button', { name: C.dismiss }));
        expect(screen.queryByTestId('calendar-oauth-error')).toBeNull();
    });
});
