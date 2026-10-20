/**
 * ROK-1598 L5b — the Calendars page made provider-generic: Apple iCloud
 * connections render beside Google under Connected, the Apple row sits under
 * "Add a calendar", Microsoft never renders, an Apple `needs_reconnect` reads
 * "Password was revoked · reconnect" and its Fix reopens the K3 sheet in
 * reconnect mode, and Disconnect reuses the shared confirm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { CalendarConnection, CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDARS_OVERVIEW_URL, CALENDAR_CONNECTION_URL, calendarConnectionFixture, calendarsOverviewFixture,
    calendarsOverviewVariants, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { buildAppleConnection } from '../../../test/factories/calendar-sync';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';
import { CalendarsPage } from './CalendarsPage';
import { APPLE_CONNECT_COPY as A } from './apple-connect.copy';
import { CALENDARS_COPY as C } from './calendar-sync.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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

function renderWith(connections: CalendarConnection[]) {
    server.use(...userCalendarHandlers(calendarsOverviewFixture({ connections })));
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter><CalendarsPage /></MemoryRouter>
        </QueryClientProvider>,
    );
}

function card(provider: CalendarConnection['provider']): HTMLElement {
    const found = screen.getAllByTestId('calendar-connection-card').find((el) => el.dataset.provider === provider);
    if (!found) throw new Error(`no ${provider} card rendered`);
    return found;
}

beforeEach(() => {
    setAccessToken('test-token');
    setDesktop(true);
});

afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('CalendarsPage — Google + Apple', () => {
    it('both cards render under Connected with their own names; both Add rows offer another account', async () => {
        renderWith([calendarConnectionFixture, buildAppleConnection()]);
        expect(await screen.findAllByTestId('calendar-connection-card')).toHaveLength(2);
        expect(within(card('google')).getByTestId('calendar-connection-name')).toHaveTextContent(C.google.name);
        expect(within(card('apple')).getByTestId('calendar-connection-name')).toHaveTextContent(A.name);
        expect(screen.getByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.hintAnother);
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hintAnother);
        // One account per provider: the email stays in the status line, not a separate account line (R3).
        expect(screen.queryByTestId('calendar-connection-account')).toBeNull();
    });

    it('Apple only: the Apple card + both Add rows; Google offers a first account', async () => {
        renderWith([buildAppleConnection()]);
        const apple = await screen.findByTestId('calendar-connection-card');
        expect(apple).toHaveAttribute('data-provider', 'apple');
        expect(within(apple).getByTestId('calendar-connection-status')).toHaveTextContent('Connected · raider@icloud.com');
        expect(screen.getByText(C.connectedHeading)).toBeInTheDocument();
        expect(screen.getByTestId('calendar-provider-google-hint')).toHaveTextContent(C.google.hint);
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hintAnother);
        expect(screen.getByTestId('calendar-connect-apple')).toBeEnabled();
    });

    it('no Apple connection: the Apple row offers a first Apple ID (withApple variant is the connected one)', async () => {
        server.use(...userCalendarHandlers(calendarsOverviewVariants.available));
        render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><CalendarsPage /></MemoryRouter></QueryClientProvider>);
        expect(await screen.findByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hint);
    });

    it('a Microsoft connection never renders — no card, no Outlook row', async () => {
        renderWith([buildAppleConnection(), { ...calendarConnectionFixture, id: 31, provider: 'microsoft' }]);
        const cards = await screen.findAllByTestId('calendar-connection-card');
        expect(cards.map((el) => el.dataset.provider)).toEqual(['apple']);
        expect(screen.queryByText(/outlook/i)).toBeNull();
        expect(screen.queryByTestId('calendar-provider-microsoft')).toBeNull();
    });
});

describe('CalendarConnectionCard — reconnect + GrantRead per provider', () => {
    it('Apple needs_reconnect: "Password was revoked · reconnect"; Fix opens the sheet in reconnect mode, email prefilled', async () => {
        renderWith([buildAppleConnection({ status: 'needs_reconnect' })]);
        expect(await screen.findByTestId('calendar-connection-status')).toHaveTextContent('Password was revoked · reconnect');
        fireEvent.click(screen.getByTestId('calendar-connection-fix'));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(A.titleReconnect)).toBeInTheDocument();
        expect(within(dialog).getByTestId('apple-connect-email')).toHaveValue('raider@icloud.com');
        expect(within(dialog).getByTestId('apple-connect-password')).toHaveValue('');
    });

    it('Google needs_reconnect keeps "Access was revoked · reconnect" and opens no Apple sheet', async () => {
        renderWith([{ ...calendarConnectionFixture, status: 'needs_reconnect' }]);
        expect(await screen.findByTestId('calendar-connection-status')).toHaveTextContent('Access was revoked · reconnect');
        expect(screen.queryByText(A.titleReconnect)).toBeNull();
    });

    it('an Apple card never offers "Grant read access"; a Google card without read still does', async () => {
        renderWith([
            { ...calendarConnectionFixture, readAccess: 'missing' },
            buildAppleConnection({ id: 22, accountLabel: 'reader@icloud.com' }),
            buildAppleConnection({ readAccess: 'missing' }),
        ]);
        await screen.findAllByTestId('calendar-connection-card');
        const grants = screen.getAllByTestId('calendar-read-grant');
        expect(grants).toHaveLength(1);
        expect(card('google').parentElement).toContainElement(grants[0] ?? null);
    });
});

describe('CalendarsPage — Apple Disconnect reuses the shared confirm', () => {
    it('Manage → Disconnect → confirm → DELETE the Apple id → overview refetched', async () => {
        const deleted: number[] = [];
        const overview = (): CalendarsOverview => (deleted.length
            ? calendarsOverviewVariants.available : calendarsOverviewVariants.withApple);
        // Separate `use` calls: MSW matches the newest list first, so these override the defaults.
        server.use(...userCalendarHandlers(calendarsOverviewVariants.withApple));
        server.use(
            http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(overview())),
            http.delete(CALENDAR_CONNECTION_URL, ({ params }) => {
                deleted.push(Number(params.id));
                return new HttpResponse(null, { status: 202 });
            }),
        );
        render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><CalendarsPage /></MemoryRouter></QueryClientProvider>);
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(within(screen.getByTestId('calendar-manage-menu')).getByRole('menuitem', { name: C.disconnect }));
        fireEvent.click(await screen.findByTestId('calendar-disconnect-confirm'));
        await waitFor(() => expect(deleted).toEqual([21]));
        await waitFor(() => expect(screen.queryByTestId('calendar-connection-card')).toBeNull());
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hint);
    });
});

describe('CalendarsPage — phone write row names Apple', () => {
    it('the K2 entry row reads "To Apple Calendar · a \\"Raid Ledger\\" calendar"', async () => {
        setDesktop(false);
        renderWith([buildAppleConnection({ write: { enabled: true, target: 'dedicated' } })]);
        expect(await screen.findByTestId('send-events-entry')).toHaveTextContent('To Apple Calendar · a "Raid Ledger" calendar');
    });
});
