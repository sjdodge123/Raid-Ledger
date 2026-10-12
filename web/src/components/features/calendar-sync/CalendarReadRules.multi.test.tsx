/**
 * ROK-1595 review r2 — two or more Google accounts. The read MODE is per user
 * (D1), so it renders once for the page and is never bound to the first
 * connection; read on/off is per connection, so each card carries its own
 * switch (keyed by id — an error cannot carry over to another account).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { CalendarConnection, CalendarReadMode } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDAR_CONNECTION_URL, CALENDARS_OVERVIEW_URL, calendarsOverviewFixture, readConnectionFixture, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';
import { CALENDARS_OVERVIEW_KEY } from '../../../hooks/use-calendar-sync';
import { CalendarsPage } from './CalendarsPage';
import { READ_COPY as R } from './calendar-sync.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../../lib/toast', async () => ({ toast: (await import('sonner')).toast }));

const realMatchMedia = window.matchMedia;
const first: CalendarConnection = readConnectionFixture;
const second: CalendarConnection = { ...readConnectionFixture, id: first.id + 1, accountLabel: 'alt@example.com' };
const third: CalendarConnection = { ...readConnectionFixture, id: first.id + 2, accountLabel: 'third@example.com' };

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

function renderPage(connections: CalendarConnection[], mode: CalendarReadMode = 'both') {
    server.use(...userCalendarHandlers(calendarsOverviewFixture({ connections, readSettings: { mode, lookAheadWeeks: 4 } })));
    const qc = createTestQueryClient();
    render(<QueryClientProvider client={qc}><MemoryRouter><CalendarsPage /></MemoryRouter></QueryClientProvider>);
    return qc;
}

/** Records every PATCH :id as {id, body}; `fail` ids answer 500. */
function recordPatches(fail: readonly number[] = []) {
    const patches: { id: string; body: unknown }[] = [];
    server.use(http.patch(CALENDAR_CONNECTION_URL, async ({ request, params }) => {
        patches.push({ id: String(params.id), body: await request.json() });
        return new HttpResponse(null, { status: fail.includes(Number(params.id)) ? 500 : 204 });
    }));
    return patches;
}

const accountSwitch = (c: CalendarConnection) => screen.findByRole('switch', { name: R.accountRead.aria(c.accountLabel ?? '') });

beforeEach(() => { setAccessToken('test-token'); setDesktop(false); });
afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('the per-user mode control', () => {
    it.each([false, true])('desktop=%s: one read-rules section, not tied to any one connection', async (desktop) => {
        setDesktop(desktop);
        renderPage([first, second]);
        const sections = await screen.findAllByTestId('calendar-read-rules');
        expect(sections, 'one per-user mode control, not one per connection card').toHaveLength(1);
        expect(sections[0]).not.toHaveAttribute('data-connection-id');
    });

    it('phone: first account needs_reconnect, second healthy → the mode switches stay enabled', async () => {
        renderPage([{ ...first, status: 'needs_reconnect', errorCode: 'auth' }, second]);
        expect(await screen.findByRole('switch', { name: R.days.aria })).toBeEnabled();
        expect(screen.getByRole('switch', { name: R.hours.aria })).toBeEnabled();
    });

    it('desktop: first account needs_reconnect, second healthy → the mode cards stay enabled', async () => {
        setDesktop(true);
        renderPage([{ ...first, status: 'needs_reconnect', errorCode: 'auth' }, second]);
        expect(await screen.findByRole('radio', { name: R.modes.days.label })).toBeEnabled();
    });

    it('first account write-only, second reads → the mode controls, not "Grant read access"', async () => {
        renderPage([{ ...first, readAccess: 'missing' }, second]);
        expect(await screen.findByRole('switch', { name: R.days.aria })).toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByTestId('calendar-read-grant')).toBeNull();
    });

    it('F-2 with two accounts: both mode switches off turns reading off on BOTH', async () => {
        renderPage([first, second], 'days');
        const patches = recordPatches();
        expect(await screen.findByRole('switch', { name: R.hours.aria })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('switch', { name: R.days.aria }));
        await waitFor(() => expect(patches).toHaveLength(2));
        expect(patches.map((p) => p.id).sort()).toEqual([String(first.id), String(second.id)].sort());
        expect(patches.map((p) => p.body)).toEqual([{ read: { enabled: false } }, { read: { enabled: false } }]);
    });
});

describe('per-account read on/off on each card', () => {
    it('one account: no per-card switch (the page switches are its on/off)', async () => {
        renderPage([first]);
        await screen.findByRole('switch', { name: R.days.aria });
        expect(screen.queryByTestId('calendar-connection-read')).toBeNull();
    });

    it('toggling read off on the second account PATCHes only the second; the first stays on', async () => {
        renderPage([first, second]);
        const patches = recordPatches();
        fireEvent.click(await accountSwitch(second));
        await waitFor(() => expect(patches).toEqual([{ id: String(second.id), body: { read: { enabled: false } } }]));
        expect(await accountSwitch(first)).toHaveAttribute('aria-checked', 'true');
    });

    it("a failed save on the first account stays with it: once it is gone, no other card shows the error", async () => {
        const qc = renderPage([first, second, third]);
        const patches = recordPatches([first.id]);
        fireEvent.click(await accountSwitch(first));
        const firstCard = screen.getAllByTestId('calendar-connection-read').find((n) => n.dataset.connectionId === String(first.id));
        expect(firstCard, 'the first account carries its own read switch').toBeDefined();
        await waitFor(() => expect(within(firstCard ?? document.body).getByTestId('calendar-connection-read-error')).toHaveTextContent(R.saveFailed));
        expect(patches).toEqual([{ id: String(first.id), body: { read: { enabled: false } } }]);
        server.use(http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(calendarsOverviewFixture({ connections: [second, third] }))));
        await qc.invalidateQueries({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
        await waitFor(() => expect(screen.getAllByTestId('calendar-connection-read').map((n) => n.dataset.connectionId))
            .toEqual([String(second.id), String(third.id)]));
        expect(screen.queryByTestId('calendar-connection-read-error'), 'the first account\'s error leaked to another card').toBeNull();
    });
});

/** Kept from the round-1 suite: the picker is per connection. */
describe('desktop picker', () => {
    it('each connection card keeps its own "Calendars to check" picker', async () => {
        setDesktop(true);
        renderPage([first, second]);
        await waitFor(() => expect(screen.getAllByTestId('calendar-picker')).toHaveLength(2));
    });
});
