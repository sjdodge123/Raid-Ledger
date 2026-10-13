/**
 * ROK-1595 review r2 — two or more Google accounts. The read MODE is per user
 * (D1), so it renders once for the page and is never bound to the first
 * connection; read on/off is per connection, so each card carries its own
 * switch (keyed by id — an error cannot carry over to another account).
 * Operator 2026-10-13: with 2+ accounts the page switches only set the mode,
 * cannot both be off, and never touch per-account on/off.
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
    CALENDAR_CONNECTION_URL, CALENDAR_READ_SETTINGS_URL, CALENDARS_OVERVIEW_URL, calendarsOverviewFixture, readConnectionFixture, userCalendarHandlers,
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

/** Records every PUT settings body. */
function recordPuts() {
    const puts: unknown[] = [];
    server.use(http.put(CALENDAR_READ_SETTINGS_URL, async ({ request }) => {
        puts.push(await request.json());
        return new HttpResponse(null, { status: 204 });
    }));
    return puts;
}

const readOff = (c: CalendarConnection): CalendarConnection => ({ ...c, read: { ...c.read, enabled: false } });

const accountSwitch = (c: CalendarConnection) => screen.findByRole('switch', { name: R.accountRead.aria(c.accountLabel ?? '') });

const cardOf = (c: CalendarConnection): HTMLElement => {
    const row = screen.getAllByTestId('calendar-connection-card').find((n) => n.dataset.connectionId === String(c.id));
    if (!row?.parentElement) throw new Error(`no card for connection ${c.id}`);
    return row.parentElement;
};

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
        expect(within(screen.getByTestId('calendar-read-rules')).queryByTestId('calendar-read-grant'), 'the page section keeps the mode controls').toBeNull();
    });

    it('one account reads, one is write-only → the write-only card shows "Grant read access"; the readable card keeps its status (AC3)', async () => {
        const missing: CalendarConnection = { ...second, readAccess: 'missing' };
        renderPage([first, missing]);
        await screen.findByRole('switch', { name: R.days.aria });
        expect(within(cardOf(missing)).getByTestId('calendar-read-grant-button'), 'the account without read access offers the grant').toHaveTextContent(R.grant);
        expect(within(cardOf(first)).queryByTestId('calendar-read-grant-button'), 'the readable account needs no grant').toBeNull();
        expect(screen.getAllByTestId('calendar-read-grant-button'), 'one CTA — none duplicated on the page section').toHaveLength(1);
    });

    it('two accounts read, a third is write-only → the readable cards keep their read switches; only the third offers the grant', async () => {
        const missing: CalendarConnection = { ...third, readAccess: 'missing' };
        renderPage([first, second, missing]);
        await accountSwitch(first);
        expect(within(cardOf(first)).getByRole('switch', { name: R.accountRead.aria(first.accountLabel ?? '') })).toHaveAttribute('aria-checked', 'true');
        expect(within(cardOf(second)).getByRole('switch', { name: R.accountRead.aria(second.accountLabel ?? '') })).toBeInTheDocument();
        expect(within(cardOf(missing)).getByTestId('calendar-read-grant-button')).toHaveTextContent(R.grant);
        expect(within(cardOf(missing)).queryByTestId('calendar-connection-read'), 'no read switch for an account that cannot read').toBeNull();
        expect(screen.getAllByTestId('calendar-read-grant-button')).toHaveLength(1);
    });

    it('one write-only account alone → only the page section offers "Grant read access" (no duplicate on the card)', async () => {
        renderPage([{ ...first, readAccess: 'missing' }]);
        const section = await screen.findByTestId('calendar-read-rules');
        expect(within(section).getByTestId('calendar-read-grant-button')).toBeInTheDocument();
        expect(screen.getAllByTestId('calendar-read-grant-button')).toHaveLength(1);
    });

});

describe('two accounts: the page switches set only the mode (operator 2026-10-13)', () => {
    it('two accounts, mode days: "Whole days" (the last one on) is locked with a hint; nothing is sent', async () => {
        renderPage([first, second], 'days');
        const patches = recordPatches();
        const puts = recordPuts();
        const days = await screen.findByRole('switch', { name: R.days.aria });
        expect(days, 'the page switches cannot both be off with 2+ accounts').toBeDisabled();
        expect(screen.getByTestId('calendar-read-keep-one')).toHaveTextContent(R.keepOne);
        expect(days, 'the locked switch is described by the keep-one hint').toHaveAccessibleDescription(expect.stringContaining(R.keepOne));
        expect(screen.getByRole('switch', { name: R.hours.aria })).toBeEnabled();
        fireEvent.click(days);
        expect(patches, 'the page control never turns an account off').toEqual([]);
        expect(puts).toEqual([]);
    });

    it('one account: both switches can still go off (F-2), so no lock and no hint', async () => {
        renderPage([first], 'days');
        expect(await screen.findByRole('switch', { name: R.days.aria })).toBeEnabled();
        expect(screen.queryByTestId('calendar-read-keep-one')).toBeNull();
    });

    it('every account off on its card: the switches still show the mode; "Busy hours" on PUTs the mode and enables no account', async () => {
        renderPage([readOff(first), readOff(second)], 'days');
        const patches = recordPatches();
        const puts = recordPuts();
        expect(await screen.findByRole('switch', { name: R.days.aria })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('switch', { name: R.hours.aria }));
        await waitFor(() => expect(puts).toEqual([{ mode: 'both' }]));
        expect(patches, 're-enabling from the page must not override the per-card choices').toEqual([]);
        expect(await accountSwitch(first)).toHaveAttribute('aria-checked', 'false');
        expect(await accountSwitch(second)).toHaveAttribute('aria-checked', 'false');
    });

    it('a per-card save in flight disables the page switches until it settles', async () => {
        renderPage([first, second]);
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        server.use(http.patch(CALENDAR_CONNECTION_URL, async () => {
            await gate;
            return new HttpResponse(null, { status: 204 });
        }));
        fireEvent.click(await accountSwitch(second));
        await waitFor(() => expect(screen.getByRole('switch', { name: R.hours.aria }), 'page control while a card saves').toBeDisabled());
        expect(await accountSwitch(first), 'other cards wait too').toBeDisabled();
        release();
        await waitFor(() => expect(screen.getByRole('switch', { name: R.hours.aria })).toBeEnabled());
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

describe('operator rulings 2026-10-13 (R2, R3) and the grant CTA guard', () => {
    it('R2: every card read off → the quiet "not reading any account" line, in the muted token', async () => {
        renderPage([readOff(first), readOff(second)]);
        const line = await screen.findByTestId('calendar-reading-none');
        expect(line).toHaveTextContent(R.notReadingAny);
        expect(line.className, 'muted, never a warning colour').toMatch(/\btext-muted\b/);
        expect(line.className).not.toMatch(/warning|danger/);
    });

    it('R2: one card still reads → no "not reading any account" line', async () => {
        renderPage([first, readOff(second)]);
        await accountSwitch(second);
        expect(screen.queryByTestId('calendar-reading-none')).toBeNull();
    });

    it('R3: two connections → each card shows its own account email under the title', async () => {
        renderPage([first, second]);
        await accountSwitch(second);
        expect(within(cardOf(first)).getByTestId('calendar-connection-account')).toHaveTextContent(first.accountLabel ?? 'missing label');
        expect(within(cardOf(second)).getByTestId('calendar-connection-account')).toHaveTextContent('alt@example.com');
    });

    it('R3: one connection → no extra account line', async () => {
        renderPage([first]);
        await screen.findByRole('switch', { name: R.days.aria });
        expect(screen.queryByTestId('calendar-connection-account')).toBeNull();
    });

    it.each([
        ['broken (needs_reconnect)', { status: 'needs_reconnect', errorCode: 'auth' }],
        ['disconnecting', { status: 'disconnecting' }],
    ] as const)('a write-only card that is %s does not offer "Grant read access"', async (_label, state) => {
        const card: CalendarConnection = { ...second, readAccess: 'missing', ...state };
        renderPage([first, card]);
        await screen.findAllByTestId('calendar-connection-card');
        await waitFor(() => expect(cardOf(card)).toBeInTheDocument());
        expect(within(cardOf(card)).queryByTestId('calendar-read-grant-button'), 'no grant CTA on a broken or disconnecting card').toBeNull();
    });
});
