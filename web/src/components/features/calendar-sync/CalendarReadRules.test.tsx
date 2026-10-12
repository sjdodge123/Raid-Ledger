/**
 * ROK-1595 L2 — the read-sync UI on Profile → Calendars against MSW: K2
 * switches (phone) and K4 radio cards (desktop) → PUT/PATCH incl. F-2, the
 * optimistic revert, the K4 picker (dedicated calendar hidden, PATCH), the
 * grant CTA, Fix on `needs_reconnect`, Sync now 202/429 (F-4), the phone
 * "Calendars to check" sheet, and the kill switch hiding all of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type { CalendarConnection, CalendarReadMode } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDAR_CONNECTION_URL, CALENDAR_READ_SETTINGS_URL, GOOGLE_CONSENT_URL_FIXTURE, GOOGLE_OAUTH_START_URL,
    calendarReadErrorHandlers, calendarsOverviewFixture, calendarsOverviewVariants, readConnectionFixture, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';
import { CalendarsPage } from './CalendarsPage';
import { READ_COPY as R } from './calendar-sync.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// `lib/toast` does `Object.assign(sonnerToast, { error: errorWithPersist })` at import time
// (ROK-127), which swaps the mocked `toast.error` for a plain wrapper once anything in the page
// tree imports it. Route it to the same sonner mock so `toast.error` stays a vi.fn.
vi.mock('../../../lib/toast', async () => ({ toast: (await import('sonner')).toast }));

const realMatchMedia = window.matchMedia;
const realLocation = window.location;

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

function renderWith(connection: Partial<CalendarConnection> = {}, mode: CalendarReadMode = 'both') {
    const overview = calendarsOverviewFixture({
        connections: [{ ...readConnectionFixture, ...connection }], readSettings: { mode, lookAheadWeeks: 4 },
    });
    server.use(...userCalendarHandlers(overview));
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter><CalendarsPage /></MemoryRouter>
        </QueryClientProvider>,
    );
}

/** Records PUT settings + PATCH :id bodies (both 204). Registered after `renderWith`'s handlers, so it wins. */
function recordWrites() {
    const puts: unknown[] = [];
    const patches: unknown[] = [];
    server.use(
        http.put(CALENDAR_READ_SETTINGS_URL, async ({ request }) => { puts.push(await request.json()); return new HttpResponse(null, { status: 204 }); }),
        http.patch(CALENDAR_CONNECTION_URL, async ({ request }) => { patches.push(await request.json()); return new HttpResponse(null, { status: 204 }); }),
    );
    return { puts, patches };
}

beforeEach(() => {
    setAccessToken('test-token');
    setDesktop(false);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.error).mockClear();
});

afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

describe('K2 phone switches', () => {
    it('mode both → both switches on, look ahead 4 weeks; turning "Whole days" off PUTs mode hours', async () => {
        renderWith();
        const writes = recordWrites();
        const days = await screen.findByRole('switch', { name: R.days.aria });
        expect(days).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: R.hours.aria })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('calendar-read-look-ahead')).toHaveTextContent('4 weeks');
        fireEvent.click(days);
        await waitFor(() => expect(writes.puts).toEqual([{ mode: 'hours' }]));
        expect(writes.patches).toEqual([]);
    });

    it('F-2: turning the last switch off PATCHes read.enabled false and sends no PUT', async () => {
        renderWith({}, 'days');
        const writes = recordWrites();
        expect(await screen.findByRole('switch', { name: R.hours.aria })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('switch', { name: R.days.aria }));
        await waitFor(() => expect(writes.patches).toEqual([{ read: { enabled: false } }]));
        expect(writes.puts).toEqual([]);
    });

    it('read off: both switches off; turning one on PATCHes enabled:true, then PUTs that mode', async () => {
        renderWith({ read: { enabled: false, calendarIds: [] } }, 'both');
        const writes = recordWrites();
        const hours = await screen.findByRole('switch', { name: R.hours.aria });
        expect(hours).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(hours);
        await waitFor(() => expect(writes.puts).toEqual([{ mode: 'hours' }]));
        expect(writes.patches).toEqual([{ read: { enabled: true } }]);
    });
});

describe('K4 desktop radio cards', () => {
    beforeEach(() => setDesktop(true));

    it('"Both (default)" is selected; picking "Busy hours only" PUTs mode hours', async () => {
        renderWith();
        const writes = recordWrites();
        expect(await screen.findByRole('radio', { name: R.modes.both.label })).toBeChecked();
        expect(screen.getByTestId('calendar-read-rules')).toHaveAttribute('data-layout', 'cards');
        expect(screen.queryByRole('switch', { name: R.days.aria })).toBeNull();
        fireEvent.click(screen.getByRole('radio', { name: R.modes.hours.label }));
        await waitFor(() => expect(writes.puts).toEqual([{ mode: 'hours' }]));
    });

    it('a failed PUT reverts to the saved mode and says "Could not save"', async () => {
        renderWith();
        server.use(calendarReadErrorHandlers.settingsFailed());
        fireEvent.click(await screen.findByRole('radio', { name: R.modes.days.label }));
        expect(await screen.findByTestId('calendar-read-error')).toHaveTextContent(R.saveFailed);
        await waitFor(() => expect(screen.getByRole('radio', { name: R.modes.both.label })).toBeChecked());
        expect(screen.getByRole('radio', { name: R.modes.days.label })).not.toBeChecked();
    });

    it('picker: hides the Raid Ledger calendar, primary checked + locked; ticking Work PATCHes both ids', async () => {
        renderWith();
        const writes = recordWrites();
        const picker = await screen.findByTestId('calendar-picker');
        const primary = await within(picker).findByRole('checkbox', { name: 'raider@example.com' });
        expect(within(picker).queryByRole('checkbox', { name: 'Raid Ledger' })).toBeNull();
        expect(primary).toBeChecked();
        expect(primary).toBeDisabled();
        fireEvent.click(within(picker).getByRole('checkbox', { name: 'Work' }));
        await waitFor(() => expect(writes.patches).toEqual([{ read: { calendarIds: ['primary', 'work@group.calendar.google.com'] } }]));
    });
});

describe('grant, Fix and kill switch', () => {
    it('readAccess missing: "Grant read access" replaces the switches and starts consent with intent=read', async () => {
        const assign = vi.fn();
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
        const urls: string[] = [];
        renderWith({ readAccess: 'missing' });
        server.use(http.get(GOOGLE_OAUTH_START_URL, ({ request }) => { urls.push(request.url); return HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE }); }));
        fireEvent.click(await screen.findByRole('button', { name: R.grant }));
        expect(screen.queryByRole('switch', { name: R.days.aria })).toBeNull();
        await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
        expect(urls[0]).toContain('intent=read');
    });

    it('needs_reconnect: red "reconnect" status, a Fix button, and the read switches disabled', async () => {
        renderWith({ status: 'needs_reconnect', errorCode: 'auth' });
        const status = await screen.findByTestId('calendar-connection-status');
        expect(status).toHaveTextContent(R.reconnect);
        expect(status).toHaveClass('text-danger');
        expect(screen.getByTestId('calendar-connection-fix')).toHaveTextContent(R.fix);
        expect(screen.getByRole('switch', { name: R.days.aria })).toBeDisabled();
    });

    it('kill switch off: no read section at all', async () => {
        server.use(...userCalendarHandlers(calendarsOverviewVariants.disabled));
        render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><CalendarsPage /></MemoryRouter></QueryClientProvider>);
        expect(await screen.findByTestId('calendars-unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-read-rules')).toBeNull();
        expect(screen.queryByTestId('calendar-picker')).toBeNull();
    });
});

describe('Manage: Sync now (F-4) and the phone picker sheet', () => {
    it('desktop: Sync now 202 → "Syncing your calendar…"', async () => {
        setDesktop(true);
        renderWith();
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(screen.getByTestId('calendar-sync-now'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(R.syncing));
    });

    it('phone: Sync now 429 → the throttled copy, not an error', async () => {
        renderWith();
        server.use(calendarReadErrorHandlers.syncThrottled());
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(await screen.findByTestId('calendar-sync-now'));
        await waitFor(() => expect(toast.info).toHaveBeenCalledWith(R.throttled));
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('read off: no Sync now row', async () => {
        renderWith({ read: { enabled: false, calendarIds: [] } });
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        expect(await screen.findByTestId('calendar-disconnect')).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-sync-now')).toBeNull();
    });

    it('phone: "Calendars to check" opens the picker in the sheet, without the Raid Ledger calendar', async () => {
        renderWith();
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        fireEvent.click(await screen.findByTestId('calendar-picker-open'));
        const sheet = await screen.findByTestId('calendar-picker-sheet');
        expect(await within(sheet).findByRole('checkbox', { name: 'Work' })).not.toBeChecked();
        expect(within(sheet).queryByRole('checkbox', { name: 'Raid Ledger' })).toBeNull();
    });
});

describe('two Google accounts — the mode is per user (D1), so it renders once', () => {
    const second: CalendarConnection = { ...readConnectionFixture, id: readConnectionFixture.id + 1, accountLabel: 'alt@example.com' };

    function renderTwo(): void {
        server.use(...userCalendarHandlers(calendarsOverviewFixture({ connections: [readConnectionFixture, second] })));
        render(<QueryClientProvider client={createTestQueryClient()}><MemoryRouter><CalendarsPage /></MemoryRouter></QueryClientProvider>);
    }

    it.each([false, true])('desktop=%s: one read-rules section, bound to the first connection', async (desktop) => {
        setDesktop(desktop);
        renderTwo();
        const sections = await screen.findAllByTestId('calendar-read-rules');
        expect(sections, 'one per-user mode control, not one per connection card').toHaveLength(1);
        expect(sections[0]).toHaveAttribute('data-connection-id', String(readConnectionFixture.id));
    });

    it('desktop: each connection card keeps its own "Calendars to check" picker', async () => {
        setDesktop(true);
        renderTwo();
        await waitFor(() => expect(screen.getAllByTestId('calendar-picker')).toHaveLength(2));
    });
});
