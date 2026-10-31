/**
 * ROK-1597 T21/T22 — the Outlook / Microsoft 365 row and card against MSW:
 * hidden until the admin configures Microsoft (§8 Q8), Connect and Fix call
 * `/oauth/microsoft/start` (never Google's), the card's tile + name, the
 * disconnect grant hint (§8 Q7), and `?connected=microsoft`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type { CalendarConnection, CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    GOOGLE_OAUTH_START_URL, MICROSOFT_CONSENT_URL_FIXTURE, calendarConnectionFixture,
    calendarsOverviewFixture, calendarsOverviewVariants, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';
import { CalendarsPage } from './CalendarsPage';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const realMatchMedia = window.matchMedia;
const realLocation = window.location;
const OUTLOOK: CalendarConnection = { ...calendarConnectionFixture, id: 41, provider: 'microsoft', accountLabel: 'raider@outlook.test' };

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

function spyOnAssign(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
    return assign;
}

/** Serves `overview`; counts GETs of Google's start route so a mis-routed Connect is caught. */
function renderPage(overview: CalendarsOverview, url = '/'): { googleStarts: () => number } {
    let googleStarts = 0;
    server.use(
        ...userCalendarHandlers(overview),
        http.get(GOOGLE_OAUTH_START_URL, () => { googleStarts += 1; return HttpResponse.json({ url: 'https://wrong.test' }); }),
    );
    render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={[url]}><CalendarsPage /></MemoryRouter>
        </QueryClientProvider>,
    );
    return { googleStarts: () => googleStarts };
}

const withMicrosoft = (connections: CalendarConnection[]): CalendarsOverview => calendarsOverviewFixture({
    providers: { google: { available: true }, microsoft: { available: true }, apple: { available: true } },
    connections,
});

beforeEach(() => {
    setAccessToken('test-token');
    setDesktop(true);
    vi.mocked(toast.success).mockClear();
});

afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

describe('CalendarsPage — Outlook row (ROK-1597 T21)', () => {
    it('is hidden while Microsoft is not configured; the Google row keeps its testid', async () => {
        renderPage(calendarsOverviewVariants.available);
        expect(await screen.findByTestId('calendar-provider-google')).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-provider-microsoft'), 'unconfigured Outlook must not render a dead row').toBeNull();
    });

    it('shows in K1 order Google, Outlook, Apple with the design copy once configured', async () => {
        renderPage(calendarsOverviewVariants.microsoftAvailable);
        const row = await screen.findByTestId('calendar-provider-microsoft');
        expect(row).toHaveTextContent(C.microsoft.name);
        expect(screen.getByTestId('calendar-provider-microsoft-hint')).toHaveTextContent(C.microsoft.hint);
        const order = Array.from(document.querySelectorAll('[data-testid^="calendar-provider-"]'))
            .map((el) => el.getAttribute('data-testid'))
            .filter((id) => id !== null && !id.endsWith('-hint'));
        expect(order).toEqual(['calendar-provider-google', 'calendar-provider-microsoft', 'calendar-provider-apple']);
    });

    it('Connect GETs /oauth/microsoft/start and assigns the Microsoft consent URL, never Google', async () => {
        const assign = spyOnAssign();
        const page = renderPage(calendarsOverviewVariants.microsoftAvailable);
        fireEvent.click(await screen.findByTestId('calendar-connect-microsoft'));
        await waitFor(() => expect(assign).toHaveBeenCalledWith(MICROSOFT_CONSENT_URL_FIXTURE));
        expect(page.googleStarts(), 'Outlook Connect must not start the Google consent').toBe(0);
    });

    it('offers another account once an Outlook account is connected', async () => {
        renderPage(withMicrosoft([OUTLOOK]));
        expect(await screen.findByTestId('calendar-provider-microsoft-hint')).toHaveTextContent(C.microsoft.hintAnother);
        expect(screen.getByTestId('calendar-connect-microsoft')).toBeEnabled();
    });
});

describe('CalendarConnectionCard — Outlook (ROK-1597 T22)', () => {
    it('renders the card with tile O and the Outlook name', async () => {
        renderPage(withMicrosoft([OUTLOOK]));
        const card = await screen.findByTestId('calendar-connection-card');
        expect(card).toHaveAttribute('data-provider', 'microsoft');
        expect(within(card).getByTestId('calendar-connection-name')).toHaveTextContent(C.microsoft.name);
        expect(within(card).getByText(C.microsoft.tile)).toBeInTheDocument();
    });

    it('needs_reconnect: Fix re-runs the Microsoft consent, not Google', async () => {
        const assign = spyOnAssign();
        const page = renderPage(withMicrosoft([{ ...OUTLOOK, status: 'needs_reconnect' }]));
        fireEvent.click(await screen.findByTestId('calendar-connection-fix'));
        await waitFor(() => expect(assign).toHaveBeenCalledWith(MICROSOFT_CONSENT_URL_FIXTURE));
        expect(page.googleStarts(), 'Outlook Fix must not start the Google consent').toBe(0);
    });

    it('the disconnect confirm carries the app-permissions hint for Outlook (§8 Q7)', async () => {
        renderPage(withMicrosoft([OUTLOOK]));
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(within(screen.getByTestId('calendar-manage-menu')).getByRole('menuitem', { name: C.disconnect }));
        const dialog = await screen.findByTestId('calendar-disconnect-dialog');
        expect(within(dialog).getByTestId('calendar-disconnect-microsoft-hint')).toHaveTextContent(C.microsoft.disconnectHint);
    });

    it('the Google disconnect confirm has no Microsoft hint', async () => {
        renderPage(calendarsOverviewVariants.connected);
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(within(screen.getByTestId('calendar-manage-menu')).getByRole('menuitem', { name: C.disconnect }));
        const dialog = await screen.findByTestId('calendar-disconnect-dialog');
        expect(within(dialog).queryByTestId('calendar-disconnect-microsoft-hint')).toBeNull();
    });

    it('the Outlook disconnect toast names Outlook / Microsoft 365, not Google', async () => {
        renderPage(withMicrosoft([OUTLOOK]));
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(within(screen.getByTestId('calendar-manage-menu')).getByRole('menuitem', { name: C.disconnect }));
        fireEvent.click(await screen.findByTestId('calendar-disconnect-confirm'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Outlook / Microsoft 365 disconnected'));
        expect(toast.success).not.toHaveBeenCalledWith(C.toastDisconnected);
    });
});

describe('CalendarsPage — ?connected=microsoft', () => {
    it('toasts the Outlook success copy', async () => {
        renderPage(withMicrosoft([OUTLOOK]), '/?connected=microsoft');
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Outlook / Microsoft 365 connected', expect.anything()));
    });
});
